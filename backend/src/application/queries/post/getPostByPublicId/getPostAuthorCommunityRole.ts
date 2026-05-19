import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { IPost, PostDTO } from "@/types";
import {
  getAuthorInternalId,
  getCommunityInternalId,
} from "./getPostByPublicId.helpers";

type AuthorCommunityRole = PostDTO["authorCommunityRole"];

export async function getPostAuthorCommunityRole(
  post: IPost,
  communityMemberRepository: Pick<
    CommunityMemberRepository,
    "findByCommunityAndUser"
  >,
): Promise<AuthorCommunityRole | undefined> {
  const communityInternalId = getCommunityInternalId(post);
  const authorInternalId = getAuthorInternalId(post);

  if (!communityInternalId || !authorInternalId) {
    return undefined;
  }

  const authorMember = await communityMemberRepository.findByCommunityAndUser(
    communityInternalId,
    authorInternalId,
  );

  if (
    authorMember &&
    (authorMember.role === "admin" || authorMember.role === "moderator")
  ) {
    return authorMember.role;
  }

  return undefined;
}
