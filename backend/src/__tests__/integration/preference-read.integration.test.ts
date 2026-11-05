import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { Types } from "mongoose";
import { FeedProfile, FeedSignal } from "@/models/feed-profile.model";
import { FeedPreferenceRepository } from "@/repositories/feed-preference.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import {
  decayedSignalWeight,
  type ContentFeatures,
} from "@/services/feed/interests.policy";

const uri = process.env.INTEGRATION_MONGODB_URI;

(uri ? describe : describe.skip)("Streaming preference reads", function () {
  this.timeout(30_000);
  const userId = new Types.ObjectId();
  const now = new Date("2026-10-27T12:00:00.000Z");
  const features: ContentFeatures = {
    version: 1,
    topics: [
      { id: "technology", weight: 0.6 },
      { id: "science", weight: 0.2 },
    ],
    format: "text",
  };
  let preferences: FeedPreferenceRepository;
  let unit: UnitOfWork;

  before(async () => {
    await mongoose.connect(uri!, {
      dbName: `ascendance_preferences_${randomUUID().replaceAll("-", "")}`,
      monitorCommands: true,
    });
    await Promise.all([FeedProfile.init(), FeedSignal.init()]);
    preferences = new FeedPreferenceRepository(FeedProfile, FeedSignal);
    unit = new UnitOfWork();
  });
  beforeEach(async () => {
    await Promise.all([FeedProfile.deleteMany({}), FeedSignal.deleteMany({})]);
  });
  afterEach(() => sinon.restore());
  after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it("preserves empty-history and explicit-choice semantics", async () => {
    expect(await preferences.read(String(userId), now)).to.deep.equal({
      selected: [],
      topics: {},
      formats: {},
      revision: 0,
      onboardingCompleted: false,
    });
    await unit.executeInTransaction(() =>
      preferences.select(String(userId), ["science"]),
    );
    expect(await preferences.read(String(userId), now)).to.deep.equal({
      selected: ["science"],
      topics: {},
      formats: {},
      revision: 1,
      onboardingCompleted: true,
    });
  });

  it("preserves the exact fixed-clock calculation across several cursor batches", async () => {
    await FeedSignal.insertMany(
      Array.from({ length: 777 }, (_, index) => ({
        userId,
        postId: new Types.ObjectId(),
        kind: index % 2 ? "like" : "repost",
        at: new Date(now.getTime() - index * 86_400_000),
        features: { ...features, format: index % 3 ? "text" : "image" },
      })),
    );
    await FeedSignal.create({
      userId: new Types.ObjectId(),
      postId: new Types.ObjectId(),
      kind: "like",
      at: now,
      features,
    });
    const signals = await FeedSignal.find({ userId }).lean().exec();
    const topics: Record<string, number> = {};
    const formats: Record<string, number> = {};
    for (const signal of signals) {
      const weight = decayedSignalWeight(signal.kind, signal.at, now);
      for (const topic of signal.features.topics)
        topics[topic.id] = (topics[topic.id] ?? 0) + topic.weight * weight;
      formats[signal.features.format] =
        (formats[signal.features.format] ?? 0) + weight;
    }
    const result = await preferences.read(String(userId), now);
    expect(result.topics).to.deep.equal(topics);
    expect(result.formats).to.deep.equal(formats);
    expect(await FeedSignal.countDocuments({ userId })).to.equal(777);
  });

  it("keeps contributions reversible and preserves choices when learning is reset", async () => {
    const postId = String(new Types.ObjectId());
    await unit.executeInTransaction(async () => {
      await preferences.select(String(userId), ["science"]);
      await preferences.setSignal(
        String(userId),
        postId,
        "like",
        features,
        true,
      );
      await preferences.setSignal(
        String(userId),
        postId,
        "repost",
        features,
        true,
      );
    });
    const signal = await FeedSignal.findOne({ userId }).orFail();
    const both = await preferences.read(String(userId), signal.at);
    expect(both.topics.technology).to.equal(3);
    expect(both.formats.text).to.equal(5);
    await unit.executeInTransaction(() =>
      preferences.setSignal(String(userId), postId, "like", features, false),
    );
    const remaining = await preferences.read(String(userId), signal.at);
    expect(remaining.topics.technology).to.equal(1.2);
    expect(remaining.formats.text).to.equal(2);
    await unit.executeInTransaction(() => preferences.reset(String(userId)));
    const reset = await preferences.read(String(userId), signal.at);
    expect(reset.selected).to.deep.equal(["science"]);
    expect(reset.topics).to.deep.equal({});
    expect(reset.formats).to.deep.equal({});
  });

  it("rejects a failed cursor without returning partial preferences and closes it", async () => {
    await FeedSignal.create({
      userId,
      postId: new Types.ObjectId(),
      kind: "like",
      at: now,
      features,
    });
    const cursor = FeedSignal.collection.find({ userId });
    const close = sinon.spy(cursor, "close");
    const failure = new Error("cursor read interrupted");
    const next = sinon.stub(cursor, "next").callThrough();
    next.onSecondCall().rejects(failure);
    const find = sinon.stub(FeedSignal.collection, "find").returns(cursor);
    let observed: unknown;
    try {
      await preferences.read(String(userId), now);
    } catch (error) {
      observed = error;
    }
    find.restore();
    expect(observed).to.equal(failure);
    sinon.assert.calledOnce(close);
  });

  it("measures history reads against 256-document streaming and the former materialized read", async () => {
    await FeedSignal.insertMany(
      Array.from({ length: 10_001 }, (_, index) => ({
        userId,
        postId: new Types.ObjectId(),
        kind: index % 2 ? "like" : "repost",
        at: new Date(now.getTime() - index * 3_600_000),
        features,
      })),
    );
    let commands = 0;
    const client = mongoose.connection.getClient();
    const countCommand = (event: {
      commandName: string;
      command: Record<string, unknown>;
    }) => {
      if (
        (event.commandName === "find" &&
          event.command.find === FeedSignal.collection.name) ||
        (event.commandName === "getMore" &&
          event.command.collection === FeedSignal.collection.name)
      )
        commands++;
    };
    client.on("commandStarted", countCommand);
    const baseline = async (stream: boolean) => {
      await FeedProfile.findOne({ userId }).lean().exec();
      const topics: Record<string, number> = {};
      const formats: Record<string, number> = {};
      const accumulate = (signal: {
        kind: "like" | "repost";
        at: Date;
        features: ContentFeatures;
      }) => {
        const weight = decayedSignalWeight(signal.kind, signal.at, now);
        for (const topic of signal.features.topics)
          topics[topic.id] = (topics[topic.id] ?? 0) + topic.weight * weight;
        formats[signal.features.format] =
          (formats[signal.features.format] ?? 0) + weight;
      };
      if (stream) {
        const cursor = FeedSignal.find({ userId })
          .select("postId kind at features -_id")
          .lean()
          .cursor({ batchSize: 256 });
        for await (const signal of cursor) accumulate(signal);
        await cursor.close();
      } else {
        for (const signal of await FeedSignal.find({ userId }).lean().exec())
          accumulate(signal);
      }
      return { topics, formats };
    };
    const measure = async (
      read: () => Promise<{ topics: Record<string, number>; formats: object }>,
    ) => {
      commands = 0;
      const startedAt = performance.now();
      const result = await read();
      return { commands, elapsedMs: performance.now() - startedAt, result };
    };
    try {
      await baseline(false);
      await baseline(true);
      await preferences.read(String(userId), now);
      const samples: Record<string, Awaited<ReturnType<typeof measure>>[]> = {
        materialized: [],
        streaming256: [],
        buffered: [],
      };
      const readers = {
        materialized: () => baseline(false),
        streaming256: () => baseline(true),
        buffered: () => preferences.read(String(userId), now),
      };
      for (let round = 0; round < 7; round++) {
        const names = Object.keys(readers) as (keyof typeof readers)[];
        for (let step = 0; step < names.length; step++) {
          const name = names[(step + round) % names.length];
          samples[name].push(await measure(readers[name]));
        }
      }
      for (const values of Object.values(samples))
        values.sort((left, right) => left.elapsedMs - right.elapsedMs);
      const materialized = samples.materialized[3];
      const streaming256 = samples.streaming256[3];
      const buffered = samples.buffered[3];
      expect(buffered.result.topics).to.deep.equal(materialized.result.topics);
      expect(buffered.result.formats).to.deep.equal(
        materialized.result.formats,
      );
      expect(buffered.result.topics).to.deep.equal(streaming256.result.topics);
      expect(buffered.commands).to.equal(materialized.commands);
      expect(buffered.commands).to.be.lessThan(streaming256.commands);
      const summary = ({
        commands: count,
        elapsedMs,
      }: {
        commands: number;
        elapsedMs: number;
      }) => ({ commands: count, elapsedMs });
      console.log(
        "[preference-query-budget]",
        JSON.stringify({
          signals: 10_001,
          materialized: summary(materialized),
          streaming256: summary(streaming256),
          buffered: summary(buffered),
        }),
      );
    } finally {
      client.off("commandStarted", countCommand);
    }
  });
});
