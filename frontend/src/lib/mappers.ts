import { IImage, IPost, Notification } from "../types";
import { devWarn } from "@/lib/devLogger";

type RawRecord = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBufferLike(value: unknown): value is { type: string; data: unknown[] } {
	return isObject(value) && value.type === "Buffer" && Array.isArray(value.data);
}

function extractSafeString(value: unknown): string | undefined {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (isObject(value) && ("_bsontype" in value || isBufferLike(value))) {
		return undefined;
	}
	return undefined;
}

function normalizeUserSnapshot(raw: RawRecord): IPost["user"] {
	const userSource = isObject(raw.user) ? raw.user : undefined;
	const authorSource = isObject(raw.author) ? raw.author : undefined;
	const fromUser = resolveSnapshot(userSource);
	if (fromUser) {
		return fromUser;
	}
	const fromAuthor = resolveSnapshot(authorSource);
	if (fromAuthor) {
		return fromAuthor;
	}
	return { publicId: "", handle: "", username: "", avatar: "" };
}

function resolveSnapshot(source?: RawRecord): IPost["user"] | null {
	if (!source) return null;
	const publicId = extractSafeString(source.publicId ?? source.userPublicId ?? source.id);
	if (!publicId) {
		return null;
	}
	return {
		publicId,
		handle: extractSafeString(source.handle) || "",
		username: extractSafeString(source.username ?? source.displayName) || "",
		avatar: extractSafeString(source.avatar ?? source.avatarUrl) || "",
	};
}

/**
 * Maps raw post data from backend to frontend IPost interface
 * Handles both legacy image format and new post format
 */
export function mapPost(rawInput: unknown): IPost {
	const raw = isObject(rawInput) ? rawInput : {};
	const normalizedUser = normalizeUserSnapshot(raw);
	const repostSource = isObject(raw.repostOf) ? raw.repostOf : undefined;

	// Extract tags (supports both string[] and ITag[])
	const tagsSource = Array.isArray(raw.tags) ? raw.tags : [];
	const tagStrings = tagsSource
		.map((t) => {
			if (typeof t === "string") return t;
			if (isObject(t) && typeof t.tag === "string") return t.tag;
			return null;
		})
		.filter((t): t is string => !!t);

	// Handle image data (may come in different formats)
	let imageUrl: string | undefined;
	let imagePublicId: string | undefined;

	if (isObject(raw.image)) {
		// New format: { image: { url, publicId } }
		imageUrl = String(raw.image.url || "");
		imagePublicId = String(raw.image.publicId || "");
	} else if (raw.url && typeof raw.url === "string") {
		// Legacy format: { url, imagePublicId }
		imageUrl = String(raw.url);
		imagePublicId = raw.imagePublicId ? String(raw.imagePublicId) : undefined;
	}

	let repostOf: IPost["repostOf"] = undefined;

	if (repostSource) {
		const repostPublicId = extractSafeString(repostSource.publicId ?? repostSource.id);
		const repostUser = resolveSnapshot(isObject(repostSource.user) ? repostSource.user : undefined);
		const repostImageSource = isObject(repostSource.image) ? repostSource.image : undefined;

		let repostImage: { url: string; publicId: string } | null = null;
		if (repostImageSource && typeof repostImageSource.url === "string") {
			repostImage = {
				url: repostImageSource.url,
				publicId: typeof repostImageSource.publicId === "string" ? repostImageSource.publicId : "",
			};
		}

		if (repostPublicId && repostUser) {
			repostOf = {
				publicId: repostPublicId,
				user: repostUser,
				body: extractSafeString(repostSource.body),
				slug: extractSafeString(repostSource.slug),
				image: repostImage,
				likes:
					typeof repostSource.likes === "number"
						? repostSource.likes
						: typeof repostSource.likesCount === "number"
							? repostSource.likesCount
							: 0,
				repostCount: typeof repostSource.repostCount === "number" ? repostSource.repostCount : 0,
				commentsCount: typeof repostSource.commentsCount === "number" ? repostSource.commentsCount : 0,
			};
		}
	}

	// Build the post object
	const post: IPost = {
		publicId: String(raw.publicId || ""),
		slug: raw.slug ? String(raw.slug) : undefined,
		body: raw.body ? String(raw.body) : undefined,
		type: repostOf ? "repost" : "original",
		repostCount: typeof raw.repostCount === "number" ? raw.repostCount : 0,
		repostOf,

		// Image data
		image: imageUrl
			? {
					url: imageUrl,
					publicId: imagePublicId || "",
				}
			: null,

		// Flattened image data (backward compatibility)
		url: imageUrl,
		imagePublicId,

		tags: tagStrings,

		user: normalizedUser,

		// Community data for community posts
		community: mapCommunity(raw.community),

		likes: typeof raw.likes === "number" ? raw.likes : 0,
		commentsCount: typeof raw.commentsCount === "number" ? raw.commentsCount : 0,
		viewsCount: typeof raw.viewsCount === "number" ? raw.viewsCount : 0,
		createdAt: new Date(String(raw.createdAt)),
		isLikedByViewer: typeof raw.isLikedByViewer === "boolean" ? raw.isLikedByViewer : false,
		isFavoritedByViewer: typeof raw.isFavoritedByViewer === "boolean" ? raw.isFavoritedByViewer : false,
		isRepostedByViewer: typeof raw.isRepostedByViewer === "boolean" ? raw.isRepostedByViewer : false,
		canDelete: typeof raw.canDelete === "boolean" ? raw.canDelete : undefined,
		authorCommunityRole: extractSafeString(raw.authorCommunityRole) as "admin" | "moderator" | "member" | undefined,
	};
	return post;
}

/**
 * Maps community data from raw post
 */
function mapCommunity(raw: unknown): IPost["community"] {
	if (!isObject(raw)) return null;
	const publicId = extractSafeString(raw.publicId);
	if (!publicId) return null;
	return {
		publicId,
		name: extractSafeString(raw.name) || "",
		slug: extractSafeString(raw.slug) || "",
		avatar: extractSafeString(raw.avatar) || undefined,
	};
}

/**
 * Legacy mapper calling mapPost
 */
export function mapImage(rawInput: unknown): IImage {
	const post = mapPost(rawInput);

	if (!post.url) {
		devWarn("mapImage called on post without image:", post.publicId);
	}

	return post as IImage;
}

/**
 * Maps an array of raw posts
 */
export function mapPosts(rawArray: unknown[]): IPost[] {
	if (!Array.isArray(rawArray)) return [];
	return rawArray.map(mapPost);
}

// Map raw notification to frontend Notification
export function mapNotification(rawInput: unknown): Notification {
	const raw = isObject(rawInput) ? rawInput : {};
	const ts = raw.timestamp;
	const idVal = (raw as RawRecord).id || (raw as RawRecord)._id;
	return {
		id: String(idVal || ""),
		userId: String(raw.userId || ""),
		actionType: String(raw.actionType || ""),
		actorId: String(raw.actorId || ""),
		actorUsername: typeof raw.actorUsername === "string" ? raw.actorUsername : undefined,
		actorHandle: typeof raw.actorHandle === "string" ? raw.actorHandle : undefined,
		actorAvatar: typeof raw.actorAvatar === "string" ? raw.actorAvatar : undefined,
		targetId: typeof raw.targetId === "string" ? raw.targetId : undefined,
		targetType: typeof raw.targetType === "string" ? raw.targetType : undefined,
		targetPreview: typeof raw.targetPreview === "string" ? raw.targetPreview : undefined,
		timestamp: typeof ts === "string" ? ts : new Date(String(ts)).toISOString(),
		isRead: Boolean(raw.isRead),
	};
}
