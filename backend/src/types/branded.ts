/**
 * Branded types for string IDs.
 *
 * Branded types prevent accidental mixing of structurally identical string IDs
 * like passing a publicId where a MongoDB internal _id is expected
 *
 * Cast helpers (as*) should only be used at trusted entry points:
 *   - Mongoose query results
 *   - Validated JWT payloads
 *   - Validated HTTP request params
 *   - ID-generation sites
 */

/**
 * prevents accidental collision in a way a plain string key wouldn't
 * Fragile version: type Brand<B> = { readonly __brand: B }
 * With unique symbol the brand key is unreferenceable from outside this module. It can't be faked
 */
declare const __brand: unique symbol;

type Brand<B> = { readonly [__brand]: B }; // the canonical TypeScript approach

/** Attaches a nominal brand B to base type T, making it distinct at compile time. */
export type Branded<T, B> = T & Brand<B>;

// ---------------------------------------------------------------------------
// Public entity IDs  (URL-safe, human-facing, externally exposed)
// ---------------------------------------------------------------------------

/** Opaque public identifier for a User entity. */
export type UserPublicId = Branded<string, "UserPublicId">;
/** Opaque public identifier for a Post entity. */
export type PostPublicId = Branded<string, "PostPublicId">;
/** Opaque public identifier for an Image (storage asset) entity. */
export type ImagePublicId = Branded<string, "ImagePublicId">;
/** Opaque public identifier for a Community entity. */
export type CommunityPublicId = Branded<string, "CommunityPublicId">;
/** Opaque public identifier for a Tag entity. */
export type TagPublicId = Branded<string, "TagPublicId">;

// ---------------------------------------------------------------------------
// Internal / persistence IDs  (MongoDB ObjectId serialised as string)
// ---------------------------------------------------------------------------

/**
 * MongoDB ObjectId serialised as a hex string.
 * Never expose this to external clients, use the corresponding publicId instead.
 */
export type MongoId = Branded<string, "MongoId">;

// ---------------------------------------------------------------------------
// Auth / session tokens
// ---------------------------------------------------------------------------

/** Opaque session identifier stored in the token (jti / sid claim). */
export type SessionId = Branded<string, "SessionId">;
/** Bcrypt hash of a refresh token. Must never be compared to a raw token. */
export type RefreshTokenHash = Branded<string, "RefreshTokenHash">;

// ---------------------------------------------------------------------------
// Cast helpers: use ONLY at trusted system boundaries
// ---------------------------------------------------------------------------

export const asUserPublicId = (s: string): UserPublicId => s as UserPublicId;
export const asPostPublicId = (s: string): PostPublicId => s as PostPublicId;
export const asImagePublicId = (s: string): ImagePublicId => s as ImagePublicId;
export const asCommunityPublicId = (s: string): CommunityPublicId =>
  s as CommunityPublicId;
export const asTagPublicId = (s: string): TagPublicId => s as TagPublicId;
export const asMongoId = (s: string): MongoId => s as MongoId;
export const asSessionId = (s: string): SessionId => s as SessionId;
export const asRefreshTokenHash = (s: string): RefreshTokenHash =>
  s as RefreshTokenHash;
