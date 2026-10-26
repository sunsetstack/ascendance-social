import "reflect-metadata";
import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import User from "@/models/user.model";
import Post from "@/models/post.model";
import PostLike from "@/models/postLike.model";
import { FeedProfile, FeedSignal } from "@/models/feed-profile.model";
import { OutboxModel } from "@/models/outbox.model";
import type { ContentFeatures, ContentFormat, InterestProfile } from "@/services/feed/interests.policy";

interface Persona { publicId: string; handle: string; email: string; password: string; topic: string; preferredFormat: ContentFormat; }
interface Manifest { synthetic: boolean; baseURL: string; cohort: string; database: string; users: Persona[]; }

async function main(): Promise<void> {
  const manifestPath = process.env.DEMO_MANIFEST;
  const output = process.env.LOAD_EVIDENCE_FILE;
  const uri = process.env.MONGODB_URI;
  if (!manifestPath || !output || !uri || !path.isAbsolute(output)) throw new Error("DEMO_MANIFEST, MONGODB_URI and absolute LOAD_EVIDENCE_FILE are required");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const database = new URL(uri);
  if (!manifest.synthetic || !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(manifest.baseURL)
    || !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || database.pathname.slice(1) !== manifest.database) throw new Error("Matching local synthetic target required");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const users = await User.find({ publicId: { $in: manifest.users.map(user => user.publicId) } }).select("_id publicId isEmailVerified").lean();
    if (users.length !== manifest.users.length || users.some(user => !user.isEmailVerified)) throw new Error("Missing or unverified cohort accounts");
    const rows = await Post.find({ user: { $in: users.map(user => user._id) } }).select("publicId contentFeatures").lean();
    const evidence: { handle: string; topic: string; preferredFormat: ContentFormat; profile: InterestProfile; top10: { publicId: string; rankScore: number; reason?: string; contentFeatures?: ContentFeatures }[]; topicCoverage: number; formatCoverage: number }[] = [];
    for (const persona of manifest.users) {
      const login = await fetch(`${manifest.baseURL}/api/users/login`, { method: "POST",
        headers: { Origin: manifest.baseURL, "Content-Type": "application/json" }, body: JSON.stringify({ email: persona.email, password: persona.password }) });
      if (login.status !== 200) throw new Error(`Evidence login failed for ${persona.handle}: ${login.status}`);
      const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      if (!cookie) throw new Error("Evidence login returned no session cookies");
      const headers = { Cookie: cookie, Origin: manifest.baseURL };
      try {
        const [profileResponse, feedResponse] = await Promise.all([
          fetch(`${manifest.baseURL}/api/feed/interests`, { headers }),
          fetch(`${manifest.baseURL}/api/feed/for-you?limit=10`, { headers }),
        ]);
        if (!profileResponse.ok || !feedResponse.ok) throw new Error(`Evidence read failed: ${profileResponse.status}/${feedResponse.status}`);
        const { profile } = await profileResponse.json() as { profile: InterestProfile };
        const { data } = await feedResponse.json() as { data: { publicId: string; rankScore: number; feedReason?: string }[] };
        const visiblePosts = await Post.find({ publicId: { $in: data.map(post => post.publicId) } }).select("publicId contentFeatures").lean();
        const features = new Map(visiblePosts.map(post => [post.publicId as string, post.contentFeatures]));
        const top10 = data.map(post => ({ publicId: post.publicId, rankScore: post.rankScore, reason: post.feedReason, contentFeatures: features.get(post.publicId) }));
        evidence.push({ handle: persona.handle, topic: persona.topic, preferredFormat: persona.preferredFormat, profile, top10,
          topicCoverage: top10.length ? top10.filter(post => post.contentFeatures?.topics.some(topic => topic.id === persona.topic)).length / top10.length : 0,
          formatCoverage: top10.length ? top10.filter(post => post.contentFeatures?.format === persona.preferredFormat).length / top10.length : 0 });
      } finally {
        const logout = await fetch(`${manifest.baseURL}/api/users/logout`, { method: "POST", headers });
        if (!logout.ok) throw new Error(`Evidence logout failed: ${logout.status}`);
      }
    }
    const userIds = users.map(user => user._id);
    const signalRows = await FeedSignal.find({ userId: { $in: userIds } }).select("userId postId kind features at").sort({ _id: 1 }).lean();
    const profileRows = await FeedProfile.find({ userId: { $in: userIds } }).select("userId selected revision resetAt").sort({ _id: 1 }).lean();
    const signalCounts = new Map(userIds.map(id => [String(id), 0]));
    for (const signal of signalRows) signalCounts.set(String(signal.userId), signalCounts.get(String(signal.userId))! + 1);
    const historySizes = [...signalCounts.values()];
    const likeRows = await PostLike.find({ userId: { $in: userIds } }).select("userId postId").lean();
    const repostRows = await Post.find({ user: { $in: userIds }, type: "repost", body: "", image: null, isDeleted: { $ne: true } }).select("user repostOf").lean();
    const domainSignals = new Set([
      ...likeRows.map(like => `${like.userId}:${like.postId}:like`),
      ...repostRows.map(post => `${post.user}:${post.repostOf}:repost`),
    ]);
    const learnedSignals = new Set(signalRows.map(signal => `${signal.userId}:${signal.postId}:${signal.kind}`));
    const outboxFilter = { clientRequestId: { $regex: `^${manifest.cohort}-` } };
    const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    const versions = (values: (number | undefined)[]): Record<string, number> => values.reduce<Record<string, number>>((counts, version) => {
      const key = String(version ?? "missing"); counts[key] = (counts[key] ?? 0) + 1; return counts;
    }, {});
    const summary = { cohort: manifest.cohort, at: new Date().toISOString(), database: manifest.database,
      users: users.length, verified: users.filter(user => user.isEmailVerified).length, posts: rows.length, signals: signalRows.length,
      likes: likeRows.length, ordinaryReposts: repostRows.length,
      missingSignals: [...domainSignals].filter(key => !learnedSignals.has(key)).length,
      orphanSignals: [...learnedSignals].filter(key => !domainSignals.has(key)).length,
      profilesWithLearning: evidence.filter(user => Object.keys(user.profile.topics).length > 0).length,
      signalHistory: { min: Math.min(...historySizes), max: Math.max(...historySizes), mean: mean(historySizes),
        histogram: historySizes.reduce<Record<string, number>>((counts, size) => { counts[size] = (counts[size] ?? 0) + 1; return counts; }, {}) },
      classificationVersions: { posts: versions(rows.map(post => post.contentFeatures?.version)), signals: versions(signalRows.map(signal => signal.features?.version)) },
      learningStateHash: createHash("sha256").update(JSON.stringify({ profiles: profileRows, signals: signalRows })).digest("hex"),
      meanTopicCoverage: mean(evidence.map(user => user.topicCoverage)), meanFormatCoverage: mean(evidence.map(user => user.formatCoverage)),
      meanPreferredFormatShare: mean(evidence.map(user => {
        const total = Object.values(user.profile.formats).reduce((sum, value) => sum + (value ?? 0), 0);
        return total > 0 ? (user.profile.formats[user.preferredFormat] ?? 0) / total : 0;
      })),
      outbox: { total: await OutboxModel.countDocuments(outboxFilter), pending: await OutboxModel.countDocuments({ ...outboxFilter, processed: false }),
        exhausted: await OutboxModel.countDocuments({ ...outboxFilter, exhaustedAt: { $ne: null } }) },
    };
    await writeFile(output, JSON.stringify({ summary, personas: evidence }, null, 2), { flag: "wx" });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally { await mongoose.disconnect(); }
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
