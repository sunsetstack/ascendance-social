type FeedIdentityValue = string | null | undefined;

const encodePart = (label: string, value: FeedIdentityValue): string => {
	if (value === null || value === undefined) return `${label}:0`;
	return `${label}:1:${encodeURIComponent(value)}`;
};

const makeFeedIdentity = (
	kind: string,
	parts: ReadonlyArray<readonly [string, FeedIdentityValue]>,
): string =>
	`feed:v1:${kind}:${parts
		.map(([label, value]) => encodePart(label, value))
		.join("|")}`;

export const feedIdentities = {
	home: (viewer?: string): string =>
		makeFeedIdentity("home", [["viewer", viewer]]),
	latest: (viewer?: string): string =>
		makeFeedIdentity("latest", [["viewer", viewer]]),
	trending: (viewer?: string): string =>
		makeFeedIdentity("trending", [["viewer", viewer]]),
	forYou: (viewer?: string): string =>
		makeFeedIdentity("for-you", [["viewer", viewer]]),
	community: (subject: string | undefined, viewer?: string): string =>
		makeFeedIdentity("community", [
			["subject", subject],
			["viewer", viewer],
		]),
	profilePosts: (subject: string | undefined, viewer?: string): string =>
		makeFeedIdentity("profile-posts", [
			["subject", subject],
			["viewer", viewer],
		]),
	profileMedia: (subject: string | undefined, viewer?: string): string =>
		makeFeedIdentity("profile-media", [
			["subject", subject],
			["viewer", viewer],
		]),
	profileLikes: (subject: string | undefined, viewer?: string): string =>
		makeFeedIdentity("profile-likes", [
			["subject", subject],
			["viewer", viewer],
		]),
	favorites: (viewer?: string): string =>
		makeFeedIdentity("favorites", [["viewer", viewer]]),
	search: (mode: string, query: string, viewer?: string): string =>
		makeFeedIdentity("search", [
			["mode", mode],
			["query", query],
			["viewer", viewer],
		]),
};
