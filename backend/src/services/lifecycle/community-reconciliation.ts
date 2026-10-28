import { Community } from "@/models/community.model";
import { CommunityMember } from "@/models/communityMember.model";
import { UnitOfWork, requireTransactionSession } from "@/database/UnitOfWork";
import { resolveOwnedCloudinaryAsset } from "@/utils/cloudinary-asset";

const MEDIA_FIELDS = [
  ["avatar", "avatarStoragePublicId"],
  ["coverPhoto", "coverPhotoStoragePublicId"],
] as const;

export async function reconcileCommunities(
  unitOfWork: UnitOfWork,
  apply = false,
  cloudName = process.env.CLOUDINARY_CLOUD_NAME,
): Promise<{
  inspected: number;
  changed: number;
  preservedMedia: number;
  repairs: Array<{ publicId: string; previousMemberCount: number | null; memberCount: number; media: Record<string, string> }>;
}> {
  const result = { inspected: 0, changed: 0, preservedMedia: 0,
    repairs: [] as Array<{ publicId: string; previousMemberCount: number | null; memberCount: number; media: Record<string, string> }> };
  const communities = Community.find().select("_id publicId stats avatar coverPhoto avatarStoragePublicId coverPhotoStoragePublicId")
    .lean().cursor({ batchSize: 100 });
  try {
    for await (const community of communities) {
      result.inspected++;
      const inspect = (current: typeof community): Record<string, string> => {
        const media: Record<string, string> = {};
        for (const [urlField, idField] of MEDIA_FIELDS) {
          if (!current[urlField] || current[idField]) continue;
          const id = resolveOwnedCloudinaryAsset(current[urlField], current.publicId, cloudName);
          if (id) media[idField] = id;
        }
        return media;
      };
      for (const [urlField, idField] of MEDIA_FIELDS) {
        if (community[urlField] && !community[idField] &&
          !resolveOwnedCloudinaryAsset(community[urlField], community.publicId, cloudName)) result.preservedMedia++;
      }
      const count = await CommunityMember.countDocuments({ communityId: community._id });
      const media = inspect(community);
      if (count === community.stats?.memberCount && Object.keys(media).length === 0) continue;

      const repair = apply ? await unitOfWork.executeInTransaction(async () => {
        const session = requireTransactionSession();
        const current = await Community.findOneAndUpdate({ _id: community._id }, { $inc: { __v: 1 } }, { new: true, session }).lean().exec();
        if (!current) return null;
        const memberCount = await CommunityMember.countDocuments({ communityId: current._id }).session(session).exec();
        const ownedMedia = inspect(current);
        await Community.updateOne({ _id: current._id }, { $set: { "stats.memberCount": memberCount, ...ownedMedia } }, { session });
        return { publicId: current.publicId, previousMemberCount: current.stats?.memberCount ?? null, memberCount, media: ownedMedia };
      }) : { publicId: community.publicId, previousMemberCount: community.stats?.memberCount ?? null, memberCount: count, media };
      if (repair) { result.changed++; result.repairs.push(repair); }
    }
  } catch (error) {
    await communities.close().catch(() => {});
    throw error;
  }
  await communities.close();
  return result;
}
