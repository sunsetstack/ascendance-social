import { IUser } from "@/types";
import { asUserPublicId } from "@/types/branded";
import { pickString } from "./dto-common";
import {
  AccountInfoDTO,
  AdminUserDTO,
  AuthenticatedUserDTO,
  HandleSuggestionDTO,
  PublicUserDTO,
} from "./dto.types";

export function toPublicUserDTO(user: IUser): PublicUserDTO {
  return {
    publicId: user.publicId,
    handle: user.handle,
    username: user.username,
    avatar: user.avatar,
    cover: user.cover,
    bio: user.bio,
    createdAt: user.createdAt,
    postCount: resolveCount(user.postCount),
    followerCount: resolveCount(user.followerCount),
    followingCount: resolveCount(user.followingCount),
  };
}

export function toHandleSuggestionDTO(user: IUser): HandleSuggestionDTO {
  const source = user?.toObject ? user.toObject() : user;
  return {
    publicId: asUserPublicId(pickString(source?.publicId)),
    handle: pickString(source?.handle),
    username: pickString(source?.username),
    avatar: pickString(source?.avatar),
  };
}

export function toAuthenticatedUserDTO(user: IUser): AuthenticatedUserDTO {
  return {
    ...toPublicUserDTO(user),
    email: user.email,
    isEmailVerified: user.isEmailVerified ?? false,
  };
}

export function toAccountInfoDTO(user: IUser): AccountInfoDTO {
  return {
    publicId: user.publicId,
    handle: user.handle,
    username: user.username,
    email: user.email,
    isEmailVerified: user.isEmailVerified ?? false,
    createdAt: user.createdAt,
    registrationIp: user.registrationIp,
  };
}

export function toAdminDTO(user: IUser): AdminUserDTO {
  return {
    ...toPublicUserDTO(user),
    email: user.email,
    isEmailVerified: user.isEmailVerified ?? false,
    isAdmin: user.isAdmin,
    isBanned: user.isBanned,
    bannedAt: user.bannedAt,
    bannedReason: user.bannedReason,
    bannedBy: user.bannedBy?.toString(),
    updatedAt: user.updatedAt,
    registrationIp: user.registrationIp,
    lastActive: user.lastActive,
    lastIp: user.lastIp,
  };
}

function resolveCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
