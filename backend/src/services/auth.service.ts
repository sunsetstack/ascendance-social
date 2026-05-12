import crypto from "crypto";
import jwt from "jsonwebtoken";
import { inject, injectable } from "tsyringe";
import { UserRepository } from "@/repositories/user.repository";
import {
  DTOService,
  AdminUserDTO,
  AuthenticatedUserDTO,
} from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { DecodedUser, IUser } from "@/types";
import { AuthSessionService } from "@/services/auth-session.service";
import { TOKENS } from "@/types/tokens";

export interface AuthSessionContext {
  ip?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  sid: string;
}

export interface AuthenticatedSessionResult extends AuthTokens {
  user: AuthenticatedUserDTO | AdminUserDTO;
}

type SessionUser = Pick<
  DecodedUser,
  "publicId" | "email" | "handle" | "username" | "isAdmin"
>;

@injectable()
export class AuthService {
  private readonly accessTokenTtlSeconds =
    Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 60 * 15;
  private readonly refreshTokenTtlSeconds =
    Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 60 * 60 * 24 * 30;

  /**
   * Creates the auth service with repository, DTO and session dependencies
   * - keeps auth orchestration in one place
   * - wires token logic to server-backed session storage
   */
  constructor(
    @inject(TOKENS.Repositories.User) private readonly userRepository: UserRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.Services.AuthSession)
    private readonly authSessionService: AuthSessionService,
  ) {}

  /**
   * Authenticates a user and starts a session
   * - verifies email and password
   * - maps the user into the right DTO shape
   * - issues access and refresh tokens bound to one sid
   */
  async login(
    email: string,
    password: string,
    context: AuthSessionContext = {},
  ): Promise<AuthenticatedSessionResult> {
    const user = await this.userRepository.findByEmail(email);
    if (
      !user ||
      typeof user.comparePassword !== "function" ||
      !(await user.comparePassword(password))
    ) {
      throw Errors.authentication("Invalid email or password");
    }

    const userDTO = user.isAdmin
      ? this.dtoService.toAdminDTO(user)
      : this.dtoService.toAuthenticatedUserDTO(user);
    const tokens = await this.issueTokensForUser(
      this.toSessionUser(user),
      context,
    );

    return { user: userDTO, ...tokens };
  }

  /**
   * Issues a fresh token pair for a known user identity
   * - creates a new refresh token and sid
   * - persists session state in Redis for revocation and rotation
   * - signs an access token tied to that sid
   */
  async issueTokensForUser(
    user: SessionUser,
    context: AuthSessionContext = {},
  ): Promise<AuthTokens> {
    const { sid, refreshToken } = this.createRefreshToken();
    await this.authSessionService.createSession({
      sid,
      publicId: user.publicId,
      refreshToken,
      ttlSeconds: this.getRefreshTokenTtlSeconds(),
      ip: context.ip,
      userAgent: context.userAgent,
    });

    const accessToken = this.generateAccessToken(user, sid);
    return { accessToken, refreshToken, sid };
  }

  /**
   * Refreshes an authenticated session using a refresh token
   * - validates refresh token against server session state
   * - rotates refresh token while keeping the same sid
   * - returns a new access token and updated refresh token
   */
  async refreshSession(
    refreshToken: string,
    context: AuthSessionContext = {},
  ): Promise<AuthenticatedSessionResult> {
    const session =
      await this.authSessionService.validateRefreshToken(refreshToken);
    const user = await this.userRepository.findByPublicId(session.publicId);
    if (!user) {
      await this.authSessionService.revokeSession(session.sid);
      throw Errors.authentication("User not found");
    }

    const userDTO = user.isAdmin
      ? this.dtoService.toAdminDTO(user)
      : this.dtoService.toAuthenticatedUserDTO(user);
    const { refreshToken: nextRefreshToken } = this.createRefreshToken(
      session.sid,
    );
    await this.authSessionService.rotateRefreshToken(
      session.sid,
      refreshToken,
      nextRefreshToken,
      this.getRefreshTokenTtlSeconds(),
      context,
    );

    const accessToken = this.generateAccessToken(
      this.toSessionUser(user),
      session.sid,
    );
    return {
      user: userDTO,
      accessToken,
      refreshToken: nextRefreshToken,
      sid: session.sid,
    };
  }

  /**
   * Revokes one session using a refresh token
   * - validates token first to get trusted session context
   * - removes only the matching sid
   */
  async revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
    const session =
      await this.authSessionService.validateRefreshToken(refreshToken);
    await this.authSessionService.revokeSession(session.sid);
  }

  /**
   * Revokes one session using an access token
   * - verifies token signature and payload
   * - requires sid in payload to target the right session
   */
  async revokeSessionByAccessToken(accessToken: string): Promise<void> {
    const payload = this.verifyAccessToken(accessToken);
    if (!payload.sid) {
      throw Errors.authentication(
        "Missing session identifier in access token",
      );
    }
    await this.authSessionService.revokeSession(payload.sid);
  }

  /**
   * Revokes every active session for a user
   * - useful for global sign out flows
   * - delegates bulk invalidation to the session service
   */
  async revokeAllSessionsForUser(publicId: string): Promise<void> {
    await this.authSessionService.revokeAllSessionsForUser(publicId);
  }

  /**
   * Signs an access token for a user and session
   * - embeds identity, sid and token metadata
   * - uses configured JWT secret and access ttl
   */
  private generateAccessToken(user: SessionUser, sid: string): string {
    const payload: DecodedUser = {
      publicId: user.publicId,
      email: user.email,
      handle: user.handle,
      username: user.username,
      isAdmin: user.isAdmin,
      sid,
      jti: crypto.randomUUID(),
      ver: 1,
    };

    return jwt.sign(payload, this.getJwtSecret(), {
      expiresIn: this.getAccessTokenTtlSeconds(),
    });
  }

  /**
   * Verifies and parses an access token
   * - normalizes JWT errors into auth-friendly error messages
   * - returns a typed decoded payload on success
   */
  private verifyAccessToken(token: string): DecodedUser {
    try {
      const decoded = jwt.verify(token, this.getJwtSecret());
      if (typeof decoded !== "object" || decoded === null) {
        throw Errors.authentication("Invalid access token");
      }
      return decoded as DecodedUser;
    } catch (error) {
      if (error instanceof Error && error.name === "TokenExpiredError") {
        throw Errors.authentication("Access token expired");
      }
      throw Errors.authentication("Invalid access token");
    }
  }

  /**
   * Reads JWT secret from env and validates presence
   * - fails fast when auth config is missing
   * - prevents signing or verifying with empty secret
   */
  private getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw Errors.internal("JWT secret is not configured");
    }
    return secret;
  }

  /**
   * Returns refresh token ttl as a safe integer
   * - validates env-derived value before use
   * - guards Redis/session expiry logic from bad config
   */
  private getRefreshTokenTtlSeconds(): number {
    if (
      !Number.isFinite(this.refreshTokenTtlSeconds) ||
      this.refreshTokenTtlSeconds <= 0
    ) {
      throw Errors.internal(
        "Invalid refresh token TTL configuration",
      );
    }
    return Math.floor(this.refreshTokenTtlSeconds);
  }

  /**
   * Returns access token ttl as a safe integer
   * - validates env-derived value before signing tokens
   * - avoids invalid expiresIn values at runtime
   */
  private getAccessTokenTtlSeconds(): number {
    if (
      !Number.isFinite(this.accessTokenTtlSeconds) ||
      this.accessTokenTtlSeconds <= 0
    ) {
      throw Errors.internal(
        "Invalid access token TTL configuration",
      );
    }
    return Math.floor(this.accessTokenTtlSeconds);
  }

  /**
   * Creates a refresh token string with sid and random secret
   * - reuses existing sid during rotation when provided
   * - keeps token format consistent as sid.secret
   */
  private createRefreshToken(existingSid?: string): {
    sid: string;
    refreshToken: string;
  } {
    const sid = existingSid || crypto.randomUUID();
    const secret = crypto.randomBytes(48).toString("hex");
    return { sid, refreshToken: `${sid}.${secret}` };
  }

  /**
   * Normalizes user shapes into the token-safe session user model
   * - supports entity and DTO variants
   * - ensures isAdmin is always a boolean
   */
  private toSessionUser(
    user: IUser | AuthenticatedUserDTO | AdminUserDTO,
  ): SessionUser {
    const withAdmin = user as { isAdmin?: boolean };
    const isAdmin =
      typeof withAdmin.isAdmin === "boolean" ? withAdmin.isAdmin : false;
    return {
      publicId: user.publicId,
      email: user.email,
      handle: user.handle,
      username: user.username,
      isAdmin,
    };
  }
}
