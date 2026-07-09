import { ICommunity, ICommunityMember } from "@/types";
import { asCommunityPublicId } from "@/types/branded";
import { normalizeUserLike, pickString } from "./dto-common";
import { CommunityDTO, CommunityMemberDTO } from "./dto.types";

export function toCommunityDTO(
  community: ICommunity,
  options?: {
    memberCount?: number;
    isMember?: boolean;
    isCreator?: boolean;
    isAdmin?: boolean;
  },
): CommunityDTO {
  const source = community?.toObject ? community.toObject() : community;
  const avatar = pickString(source?.avatar);
  const coverPhoto = pickString(source?.coverPhoto);
  const stats = source?.stats ?? {};

  return {
    publicId: asCommunityPublicId(pickString(source?.publicId)),
    name: pickString(source?.name),
    slug: pickString(source?.slug),
    description: pickString(source?.description),
    avatar: avatar || undefined,
    coverPhoto: coverPhoto || undefined,
    stats: {
      memberCount: options?.memberCount ?? stats.memberCount ?? 0,
      postCount: stats.postCount ?? 0,
    },
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    isMember: options?.isMember,
    isCreator: options?.isCreator,
    isAdmin: options?.isAdmin,
  };
}

export function toCommunityMemberDTO(
  member: ICommunityMember,
): CommunityMemberDTO {
  const userCandidate = (member as { userId?: unknown })?.userId;
  const userSnapshot = normalizeUserLike(userCandidate) ?? {
    publicId: "",
    handle: "",
    username: "",
    avatar: "",
  };

  return {
    userId: {
      publicId: userSnapshot.publicId,
      handle: userSnapshot.handle,
      username: userSnapshot.username,
      avatar: userSnapshot.avatar || undefined,
    },
    role: member.role,
    joinedAt: member.joinedAt,
  };
}
