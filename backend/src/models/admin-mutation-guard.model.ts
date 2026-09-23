import mongoose, { Document, Schema } from "mongoose";

export interface IAdminMutationGuard extends Document {
  version: number;
}

export const ADMIN_MUTATION_GUARD_ID = new mongoose.Types.ObjectId(
  "000000000000000000000001",
);

const adminMutationGuardSchema = new Schema<IAdminMutationGuard>({
  version: { type: Number, required: true, default: 0 },
});

export const AdminMutationGuard = mongoose.model<IAdminMutationGuard>(
  "AdminMutationGuard",
  adminMutationGuardSchema,
);
