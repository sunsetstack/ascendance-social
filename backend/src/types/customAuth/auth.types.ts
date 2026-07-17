import { RefreshTokenHash, SessionId, UserPublicId } from "@/types/branded";

/**
 * JWT Payload structure for authenticated users
 * this represents the claims stored in the JWT token
 */
export interface DecodedUser {
  publicId: UserPublicId;
  email: string;
  handle: string;
  username: string;
  isAdmin: boolean;
  isEmailVerified?: boolean;
  sid?: SessionId;
  jti?: string;
  ver?: number;
  iat?: number; // issued at (added by JWT)
  exp?: number; // expiration (added by JWT)
}

export interface SessionUserClaims {
  publicId: UserPublicId;
  email: string;
  handle: string;
  username: string;
  isAdmin: boolean;
  isEmailVerified: boolean;
}

export interface AuthSessionRecord {
  sid: SessionId;
  publicId: UserPublicId;
  isEmailVerified: boolean;
  refreshTokenHash: RefreshTokenHash;
  refreshVersion: number;
  previousRefreshTokenHash?: RefreshTokenHash;
  previousRefreshTokenGraceUntil?: number;
  createdAt: number;
  lastSeenAt: number;
  ip?: string;
  userAgent?: string;
  status: "active";
}

/**
 * Admin context attached to requests for audit logging
 */
export interface AdminContext {
  adminId: UserPublicId;
  adminUsername: string;
  timestamp: Date;
  ip?: string;
  userAgent?: string;
}
