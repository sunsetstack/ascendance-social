import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { Types } from "mongoose";
import { Community } from "@/models/community.model";
import { CommunityMember } from "@/models/communityMember.model";
import { UnitOfWork, requireTransactionSession } from "@/database/UnitOfWork";
import { reconcileCommunities } from "@/services/lifecycle/community-reconciliation";

const uri = process.env.INTEGRATION_MONGODB_URI;
(uri ? describe : describe.skip)(
  "Community history reconciliation",
  function () {
    this.timeout(30_000);
    let unit: UnitOfWork;
    const owner = randomUUID();
    before(async () => {
      await mongoose.connect(uri!, {
        dbName: `ascendance_community_repair_${randomUUID().replaceAll("-", "")}`,
      });
      await Promise.all([Community.init(), CommunityMember.init()]);
      unit = new UnitOfWork();
    });
    beforeEach(async () => {
      await Promise.all([
        Community.deleteMany({}),
        CommunityMember.deleteMany({}),
      ]);
      const community = await Community.create({
        publicId: owner,
        name: "Repair",
        slug: "repair",
        creatorId: new Types.ObjectId(),
        stats: { memberCount: -7, postCount: 5 },
        avatar: `https://res.cloudinary.com/example/image/upload/v1/${owner}/avatar.png`,
        coverPhoto:
          "https://res.cloudinary.com/example/image/upload/v1/shared/cover.png",
      });
      await CommunityMember.create([
        {
          communityId: community._id,
          userId: new Types.ObjectId(),
          role: "admin",
        },
        {
          communityId: community._id,
          userId: new Types.ObjectId(),
          role: "member",
        },
      ]);
    });
    afterEach(() => sinon.restore());
    after(async () => {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });

    it("previews drift and owned-media IDs without changing the database", async () => {
      const result = await reconcileCommunities(unit, false, "example");
      expect(result).to.include({
        inspected: 1,
        changed: 1,
        preservedMedia: 1,
      });
      expect(result.repairs[0]).to.include({
        previousMemberCount: -7,
        memberCount: 2,
      });
      expect(result.repairs[0]!.media).to.deep.equal({
        avatarStoragePublicId: `${owner}/avatar`,
      });
      const community = await Community.findOne().orFail();
      expect(community.stats.memberCount).to.equal(-7);
      expect(community.avatarStoragePublicId).to.equal(undefined);
    });

    it("repairs counts and proven ownership atomically while preserving shared URLs", async () => {
      await reconcileCommunities(unit, true, "example");
      const community = await Community.findOne().orFail();
      expect(community.stats).to.include({ memberCount: 2, postCount: 5 });
      expect(community.avatarStoragePublicId).to.equal(`${owner}/avatar`);
      expect(community.coverPhotoStoragePublicId).to.equal(undefined);
      expect(
        (await reconcileCommunities(unit, true, "example")).changed,
      ).to.equal(0);
    });

    it("recounts after acquiring the community mutation boundary", async () => {
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const original = Community.collection.findOneAndUpdate.bind(
        Community.collection,
      );
      const lock = sinon
        .stub(Community.collection, "findOneAndUpdate")
        .callThrough();
      lock.onFirstCall().callsFake(async (...args) => {
        started();
        await gate;
        return original(...args);
      });
      const repair = reconcileCommunities(unit, true, "example");
      await ready;
      const community = await Community.findOne().orFail();
      await new UnitOfWork().executeInTransaction(async () => {
        const session = requireTransactionSession();
        await CommunityMember.create(
          [
            {
              communityId: community._id,
              userId: new Types.ObjectId(),
              role: "member",
            },
          ],
          { session },
        );
        await Community.updateOne(
          { _id: community._id },
          { $inc: { "stats.memberCount": 1 } },
          { session },
        );
      });
      release();
      await repair;
      expect((await Community.findOne().orFail()).stats.memberCount).to.equal(
        3,
      );
    });
  },
);
