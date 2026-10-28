import "reflect-metadata";
import mongoose from "mongoose";
import { UnitOfWork } from "@/database/UnitOfWork";
import { reconcileCommunities } from "@/services/lifecycle/community-reconciliation";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: false, autoCreate: false });
  const apply = process.argv.includes("--apply");
  const result = await reconcileCommunities(new UnitOfWork(), apply);
  console.log(JSON.stringify({ database: mongoose.connection.name, mode: apply ? "apply" : "preview", ...result }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
