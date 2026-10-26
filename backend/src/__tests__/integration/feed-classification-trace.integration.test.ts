import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { Types } from "mongoose";
import Post from "@/models/post.model";
import { FeedProfile, FeedSignal } from "@/models/feed-profile.model";
import { FeedPreferenceRepository } from "@/repositories/feed-preference.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import type { ContentFeatures } from "@/services/feed/interests.policy";
import { createLogContractFormat, logger } from "@/utils/winston";

const uri = process.env.INTEGRATION_MONGODB_URI;
const databaseName = `ascendance_trace_${randomUUID().replaceAll("-", "")}`;

(uri ? describe : describe.skip)("Hydrated feed classification tracing", function () {
  this.timeout(30_000);
  let connected = false;

  before(async () => {
    const target = new URL(uri!);
    if (target.protocol !== "mongodb:" || target.hostname !== "127.0.0.1"
      || !target.port || target.pathname !== "/ascendance_integration"
      || target.username || target.password || mongoose.connection.readyState !== 0) {
      throw new Error("An isolated loopback integration database is required");
    }
    await mongoose.connect(uri!, { dbName: databaseName, serverSelectionTimeoutMS: 5_000 });
    connected = true;
    for (const model of [Post, FeedProfile, FeedSignal]) await model.init();
  });

  after(async () => {
    if (!connected) return;
    try {
      if (mongoose.connection.name !== databaseName) throw new Error("Refusing to drop an unexpected database");
      await mongoose.connection.dropDatabase();
    } finally { await mongoose.disconnect(); }
  });

  it("preserves exact classification and learning deltas without serializing the hydrated parent", async () => {
    const actor = new Types.ObjectId();
    const author = new Types.ObjectId();
    const sentinel = `PRIVATE_POST_BODY_${randomUUID().replaceAll("-", "")}`;
    const expected: ContentFeatures = { version: 2, topics: [{ id: "finance", weight: 0.2 }], format: "image" };
    const created = await Post.create({
      user: author, author: { _id: author, publicId: randomUUID(), handle: "trace-fixture", username: "Trace fixture" },
      body: `#finance #${sentinel}`, image: new Types.ObjectId(), contentFeatures: expected,
    });
    const post = await Post.findById(created._id).orFail().exec();
    expect(post.contentFeatures).to.be.instanceOf(mongoose.Document);
    const preferences = new FeedPreferenceRepository(FeedProfile, FeedSignal);
    const unit = new UnitOfWork();
    const previousTrace = process.env.FEED_TRACE_ENABLED;
    const tracedLogger: { info: (message: string, metadata?: Record<string, unknown>) => typeof logger } = logger;
    const info = sinon.stub(tracedLogger, "info");
    process.env.FEED_TRACE_ENABLED = "true";
    try {
      await unit.executeInTransaction(() => preferences.setSignal(String(actor), String(post._id), "like", post.contentFeatures!, true));
      const signal = await FeedSignal.findOne({ userId: actor, postId: post._id, kind: "like" }).lean().orFail().exec();
      expect(signal.features).to.deep.equal(expected);
      const profile = await preferences.read(String(actor), signal.at);
      expect(profile).to.deep.equal({ selected: [], topics: { finance: 3 * 0.2 }, formats: { image: 3 }, revision: 1 });

      await unit.executeInTransaction(() => preferences.setSignal(String(actor), String(post._id), "like", post.contentFeatures!, false));
      expect(await FeedSignal.countDocuments({ userId: actor })).to.equal(0);
      expect((await FeedProfile.findOne({ userId: actor }).lean().orFail().exec()).revision).to.equal(2);

      const format = createLogContractFormat();
      const records = info.getCalls().map(call => format.transform({
        level: "info", message: call.args[0], ...call.args[1],
      } as never, {}) as Record<string, unknown>);
      const staged = records.filter(record => record.event === "feed.signal.staged");
      const contributions = records.filter(record => record.event === "feed.profile.contribution");
      expect(staged).to.have.length(2);
      expect(contributions).to.have.length(1);
      for (const record of [...staged, ...contributions]) expect(record.classification).to.deep.equal(expected);
      expect(staged[0]).to.include({ active: true, changed: true, decayedDelta: 3 });
      expect(staged[0].topicDelta).to.deep.equal({ finance: 3 * 0.2 });
      expect(staged[0].formatDelta).to.deep.equal({ image: 3 });
      expect(contributions[0].decayedWeight).to.equal(3);
      expect(contributions[0].topics).to.deep.equal({ finance: 3 * 0.2 });
      expect(contributions[0].format).to.deep.equal({ image: 3 });

      const removedAgeDays = (Date.parse(staged[1].evaluatedAt as string) - signal.at.getTime()) / 86_400_000;
      const removedWeight = -3 * Math.pow(0.5, removedAgeDays / 30);
      expect(staged[1]).to.include({ active: false, changed: true, decayedDelta: removedWeight });
      expect(staged[1].topicDelta).to.deep.equal({ finance: 0.2 * removedWeight });
      expect(staged[1].formatDelta).to.deep.equal({ image: removedWeight });
      const serialized = JSON.stringify(records);
      for (const forbidden of [sentinel, "$__", "_doc", "[MaxDepth]"]) expect(serialized).not.to.include(forbidden);
    } finally {
      info.restore();
      if (previousTrace === undefined) delete process.env.FEED_TRACE_ENABLED;
      else process.env.FEED_TRACE_ENABLED = previousTrace;
    }
  });
});
