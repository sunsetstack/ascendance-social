import "reflect-metadata";
import mongoose, { mongo } from "mongoose";

interface StoredImage {
  _id: mongo.ObjectId;
  url?: string;
  width?: number;
  height?: number;
}

interface CloudinaryImageInfo {
  input?: {
    width?: number;
    height?: number;
  };
}

function buildInfoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "res.cloudinary.com") return null;
    if (!url.pathname.includes("/image/upload/")) return null;
    url.pathname = url.pathname.replace("/image/upload/", "/image/upload/fl_getinfo/");
    return url.toString();
  } catch {
    return null;
  }
}

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function fetchDimensions(
  url: string,
): Promise<{ width: number; height: number } | null> {
  const infoUrl = buildInfoUrl(url);
  if (!infoUrl) return null;

  const response = await fetch(infoUrl, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Cloudinary metadata request failed with ${response.status}`);
  }

  const data = (await response.json()) as CloudinaryImageInfo;
  if (!isDimension(data.input?.width) || !isDimension(data.input?.height)) {
    throw new Error("Cloudinary metadata response did not contain dimensions");
  }

  return { width: data.input.width, height: data.input.height };
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required.");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection did not expose a database.");

  const collection = db.collection<StoredImage>("images");
  const images = await collection
    .find({
      url: { $type: "string" },
      $or: [
        { width: { $exists: false } },
        { height: { $exists: false } },
        { width: { $lte: 0 } },
        { height: { $lte: 0 } },
      ],
    })
    .project({ _id: 1, url: 1, width: 1, height: 1 })
    .toArray();

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const image of images) {
    if (!image.url) {
      skipped += 1;
      continue;
    }

    try {
      const dimensions = await fetchDimensions(image.url);
      if (!dimensions) {
        skipped += 1;
        continue;
      }

      await collection.updateOne(
        { _id: image._id },
        { $set: dimensions },
      );
      updated += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed ${image._id.toHexString()}: ${message}`);
    }
  }

  console.log(
    `Image dimensions: ${updated} updated, ${skipped} skipped, ${failed} failed.`,
  );
  if (failed > 0) {
    throw new Error(`Failed to backfill ${failed} image record(s).`);
  }
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
