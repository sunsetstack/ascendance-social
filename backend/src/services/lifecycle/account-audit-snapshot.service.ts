import { randomUUID } from "node:crypto";
import { Model, mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import {
  AccountLifecycleAction,
  accountLifecycleKey,
} from "@/application/common/policies/account-lifecycle.policy";
import { SecurityAuditService } from "@/services/security-audit.service";
import { IUser, SecurityAuditActor } from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";

const ACTIVITY_WINDOW_DAYS = 30;
const SNAPSHOT_CHUNK_SIZE = 200;

type Db = mongo.Db;
type Document = mongo.Document;
type ObjectId = mongo.ObjectId;

interface SnapshotUser extends Document {
  _id: ObjectId;
  publicId: string;
}

interface SnapshotSource {
  name: string;
  records: Document[];
}

export interface CaptureAccountAuditSnapshotInput {
  action: AccountLifecycleAction;
  actor: SecurityAuditActor;
  targetUserId: ObjectId;
  targetUserPublicId: string;
  reason: string;
}

@injectable()
export class AccountAuditSnapshotService {
  constructor(
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
    @inject(TOKENS.Services.SecurityAudit)
    private readonly securityAuditService: SecurityAuditService,
  ) {}

  async capture(input: CaptureAccountAuditSnapshotInput): Promise<string> {
    const snapshotId = randomUUID();
    const capturedAt = new Date();
    const windowStart = new Date(
      capturedAt.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const sources = await this.loadSources(
      input.targetUserId,
      input.targetUserPublicId,
      windowStart,
    );
    const target = { type: "user", id: input.targetUserPublicId };
    const eventPrefix = `account.${input.action}.evidence`;

    await this.securityAuditService.record({
      eventType: `${eventPrefix}.started`,
      actor: input.actor,
      target,
      outcome: "success",
      reason: input.reason,
      metadata: {
        snapshotId,
        capturedAt,
        activityWindow: {
          from: windowStart,
          to: capturedAt,
          days: ACTIVITY_WINDOW_DAYS,
        },
        sourceCounts: Object.fromEntries(
          sources.map((source) => [source.name, source.records.length]),
        ),
      },
    });

    let chunkCount = 0;
    for (const source of sources) {
      const totalChunks = Math.ceil(
        source.records.length / SNAPSHOT_CHUNK_SIZE,
      );
      for (let index = 0; index < totalChunks; index += 1) {
        const records = source.records.slice(
          index * SNAPSHOT_CHUNK_SIZE,
          (index + 1) * SNAPSHOT_CHUNK_SIZE,
        );
        await this.securityAuditService.record({
          eventType: `${eventPrefix}.chunk`,
          actor: input.actor,
          target,
          outcome: "success",
          reason: input.reason,
          metadata: {
            snapshotId,
            source: source.name,
            chunk: index + 1,
            totalChunks,
            records,
          },
        });
        chunkCount += 1;
      }
    }

    await this.securityAuditService.record({
      eventType: `${eventPrefix}.completed`,
      actor: input.actor,
      target,
      outcome: "success",
      reason: input.reason,
      metadata: {
        snapshotId,
        chunkCount,
        sourceCounts: Object.fromEntries(
          sources.map((source) => [source.name, source.records.length]),
        ),
      },
    });

    return snapshotId;
  }

  private async loadSources(
    userId: ObjectId,
    userPublicId: string,
    windowStart: Date,
  ): Promise<SnapshotSource[]> {
    const db = this.db();
    const profile = await db.collection<SnapshotUser>("users").findOne(
      { _id: userId },
      {
        projection: {
          password: 0,
          resetToken: 0,
          resetTokenExpires: 0,
          emailVerificationToken: 0,
          emailVerificationExpires: 0,
        },
      },
    );
    if (!profile) {
      throw Errors.notFound("User");
    }

    const posts = await db.collection("posts").find({ user: userId }).toArray();
    const comments = await db
      .collection("comments")
      .find({
        $or: [
          { userId },
          { departedUserKey: accountLifecycleKey(userPublicId) },
        ],
      })
      .toArray();
    const postLikes = await db
      .collection("postlikes")
      .find({ userId })
      .toArray();
    const commentLikes = await db
      .collection("commentlikes")
      .find({ userId })
      .toArray();
    const favorites = await db
      .collection("favorites")
      .find({ userId })
      .toArray();
    const postViews = await db
      .collection("postviews")
      .find({ user: userId })
      .toArray();
    const follows = await db
      .collection("follows")
      .find({ $or: [{ followerId: userId }, { followeeId: userId }] })
      .toArray();
    const images = await db.collection("images").find({ user: userId }).toArray();
    const memberships = await db
      .collection("communitymembers")
      .find({ userId })
      .toArray();
    const preferences = await db
      .collection("userpreferences")
      .find({ userId })
      .toArray();
    const conversations = await db
      .collection("conversations")
      .find({
        $or: [
          { participants: userId },
          { "departedParticipants.publicId": userPublicId },
        ],
      })
      .toArray();
    const messages = await db
      .collection("messages")
      .find({
        $or: [
          { sender: userId },
          { "senderSnapshot.publicId": userPublicId },
        ],
      })
      .toArray();
    const notifications = await db
      .collection("notifications")
      .find({
        $and: [
          {
            $or: [
              { userId: userPublicId },
              { userId: userId.toHexString() },
              { actorId: userPublicId },
              { actorId: userId.toHexString() },
            ],
          },
          { timestamp: { $gte: windowStart } },
        ],
      })
      .toArray();
    const userActions = await db
      .collection("useractions")
      .find({ userId, timestamp: { $gte: windowStart } })
      .toArray();
    const requestLogs = await db
      .collection("requestlogs")
      .find({
        "metadata.userId": userPublicId,
        timestamp: { $gte: windowStart },
      })
      .toArray();
    const authActivity = await db
      .collection("authActivityLogs")
      .find({
        "metadata.userId": userPublicId,
        timestamp: { $gte: windowStart },
      })
      .toArray();
    const priorSecurityAudit = await db
      .collection("securityAuditEvents")
      .find({
        occurredAt: { $gte: windowStart },
        $or: [
          { "actor.userId": userPublicId },
          { "target.id": userPublicId },
        ],
      })
      .toArray();

    return [
      { name: "profile", records: [profile] },
      { name: "posts", records: posts },
      { name: "comments", records: comments },
      { name: "postLikes", records: postLikes },
      { name: "commentLikes", records: commentLikes },
      { name: "favorites", records: favorites },
      { name: "postViews", records: postViews },
      { name: "follows", records: follows },
      { name: "images", records: images },
      { name: "communityMemberships", records: memberships },
      { name: "preferences", records: preferences },
      { name: "conversations", records: conversations },
      { name: "messages", records: messages },
      { name: "notifications30d", records: notifications },
      { name: "userActions30d", records: userActions },
      { name: "requestLogs30d", records: requestLogs },
      { name: "authActivity30d", records: authActivity },
      { name: "securityAudit30d", records: priorSecurityAudit },
    ];
  }

  private db(): Db {
    const db = this.userModel.db.db;
    if (!db) {
      throw Errors.database("MongoDB connection is not initialized");
    }
    return db;
  }
}
