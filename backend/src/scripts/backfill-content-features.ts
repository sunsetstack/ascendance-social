import "reflect-metadata";
import mongoose from "mongoose";
import Post from "@/models/post.model";
import { Tag } from "@/models/image.model";
import { backfillContentFeatures } from "@/services/feed/backfill-content-features";

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  try {
    const count = await backfillContentFeatures(Post, Tag, apply);
    process.stdout.write(`${apply ? "Classified" : "Would classify"} ${count} posts.\n`);
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
