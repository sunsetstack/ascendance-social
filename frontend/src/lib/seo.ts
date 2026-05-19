const SITE_NAME = "Ascendance Social";
const DEFAULT_SITE_URL = "https://ascendance.social";

export const DEFAULT_TITLE = `${SITE_NAME} - Community-driven social media`;
export const DEFAULT_DESCRIPTION =
	"Ascendance Social is a modern social media platform for discovering communities, sharing posts, and connecting with people.";
export const DEFAULT_IMAGE = "/logo.svg";

const siteUrl = (import.meta.env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");

export const normalizeText = (value: string | undefined, fallback: string): string => {
	const normalized = value?.replace(/\s+/g, " ").trim();
	return normalized && normalized.length > 0 ? normalized : fallback;
};

export const truncate = (value: string, max = 160): string => {
	if (value.length <= max) return value;
	return `${value.slice(0, max - 1).trimEnd()}...`;
};

export const buildAbsoluteUrl = (value: string): string => {
	if (value.startsWith("http://") || value.startsWith("https://")) return value;
	const normalizedPath = value.startsWith("/") ? value : `/${value}`;
	return `${siteUrl}${normalizedPath}`;
};

const withSiteName = (title: string): string => `${title} | ${SITE_NAME}`;

export interface SeoMetadata {
	title?: string;
	description?: string;
	path?: string;
	image?: string;
	type?: "website" | "article";
	noindex?: boolean;
	keywords?: string;
}

interface DiscoveryMetadataOptions {
	feed?: string | null;
}

interface CommunityMetadataOptions {
	slug?: string;
	name?: string;
	description?: string;
}

interface ProfileMetadataOptions {
	id?: string;
	handle?: string;
	username?: string;
	bio?: string;
}

interface PostMetadataOptions {
	id?: string;
	body?: string;
	authorHandle?: string;
	authorName?: string;
	image?: string;
	communityName?: string;
}

export const buildHomeMetadata = (): SeoMetadata => ({
	title: withSiteName("Home"),
	description: "Discover the latest posts, trending content, and community conversations on Ascendance Social.",
	path: "/",
	type: "website",
	keywords: "social media, communities, posts, discovery",
});

export const buildDiscoveryMetadata = ({ feed }: DiscoveryMetadataOptions = {}): SeoMetadata => {
	const feedLabelMap: Record<string, string> = {
		trending: "Trending",
		latest: "Latest",
		new: "Latest",
		foryou: "For You",
		following: "Following",
	};
	const normalizedFeed = (feed || "").toLowerCase();
	const feedLabel = feedLabelMap[normalizedFeed];
	const feedSuffix = feedLabel ? ` - ${feedLabel}` : "";
	const feedQuery = feed ? `?feed=${encodeURIComponent(feed)}` : "";

	return {
		title: withSiteName(`Discover${feedSuffix}`),
		description: "Explore trending, latest, and personalized content curated for you on Ascendance Social.",
		path: `/discover${feedQuery}`,
		type: "website",
		keywords: "discover feed, trending posts, social feed",
	};
};

export const buildSearchMetadata = (query: string, search: string): SeoMetadata => {
	const normalizedQuery = query.trim();
	const safeQuery = normalizedQuery ? `"${normalizedQuery}"` : "people, posts, and communities";

	return {
		title: withSiteName(`Search ${safeQuery}`),
		description: truncate(`Search Ascendance Social for ${safeQuery}. Browse posts, users, and communities.`),
		path: `/results${search || ""}`,
		type: "website",
		keywords: "search social media, find users, find communities",
	};
};

export const buildCommunitiesMetadata = (): SeoMetadata => ({
	title: withSiteName("Communities"),
	description: "Find and join communities on Ascendance Social based on your interests.",
	path: "/communities",
	type: "website",
	keywords: "communities, groups, social network",
});

export const buildCommunityMetadata = ({ slug, name, description }: CommunityMetadataOptions): SeoMetadata => {
	const communityName = normalizeText(name, "Community");
	const communityDescription = truncate(
		normalizeText(description, `Join ${communityName} on Ascendance Social and follow the latest posts.`),
	);

	return {
		title: withSiteName(communityName),
		description: communityDescription,
		path: slug ? `/communities/${slug}` : "/communities",
		type: "website",
		keywords: `community, ${communityName}, social posts`,
	};
};

export const buildProfileMetadata = ({ id, handle, username, bio }: ProfileMetadataOptions): SeoMetadata => {
	const profileLabel = normalizeText(username, handle ? `@${handle}` : "Profile");
	const safeBio = normalizeText(bio, `${profileLabel}'s profile on Ascendance Social.`);

	return {
		title: withSiteName(profileLabel),
		description: truncate(safeBio),
		path: handle ? `/profile/${handle}` : id ? `/profile/${id}` : "/",
		type: "website",
		keywords: `profile, ${profileLabel}, social media`,
	};
};

export const buildPostMetadata = ({
	id,
	body,
	authorHandle,
	authorName,
	image,
	communityName,
}: PostMetadataOptions): SeoMetadata => {
	const author = normalizeText(authorName, authorHandle ? `@${authorHandle}` : "Ascendance user");
	const fallback = communityName
		? `Read a post by ${author} in ${communityName} on Ascendance Social.`
		: `Read a post by ${author} on Ascendance Social.`;
	const description = truncate(normalizeText(body, fallback));

	return {
		title: withSiteName(`Post by ${author}`),
		description,
		path: id ? `/posts/${id}` : "/",
		image,
		type: "article",
		keywords: "social post, community post, discussion",
	};
};
