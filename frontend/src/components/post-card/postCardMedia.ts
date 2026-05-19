import { IPost } from "../../types";
import {
	buildMediaUrl,
	buildResponsiveCloudinarySrcSet,
	transformCloudinaryUrl,
} from "../../lib/media";

export interface PostCardMediaAssets {
	hasImage: boolean;
	communityAvatarUrl: string | null;
	userAvatarUrl: string | null;
	postImageUrl: string | null;
	postImageSrcSet: string | undefined;
	repostAvatarUrl: string | null;
	repostImageUrl: string | null;
	repostImageSrcSet: string | undefined;
}

export const buildPostCardMedia = (post: IPost): PostCardMediaAssets => {
	const fullImageUrl = buildMediaUrl(post.url) ?? buildMediaUrl(post.image?.url);
	const repostImageRawUrl = buildMediaUrl(post.repostOf?.image?.url);

	return {
		hasImage: !!fullImageUrl,
		communityAvatarUrl:
			transformCloudinaryUrl(buildMediaUrl(post.community?.avatar), {
				width: 48,
				height: 48,
				crop: "fill",
			}) ?? null,
		userAvatarUrl:
			transformCloudinaryUrl(buildMediaUrl(post.user?.avatar), {
				width: 80,
				height: 80,
				crop: "fill",
			}) ?? null,
		postImageUrl:
			transformCloudinaryUrl(fullImageUrl, {
				width: 960,
				crop: "limit",
				quality: "auto:eco",
				dpr: false,
			}) ?? null,
		postImageSrcSet: buildResponsiveCloudinarySrcSet(fullImageUrl, [320, 480, 640, 768, 960, 1080], {
			crop: "limit",
			quality: "auto:eco",
		}),
		repostAvatarUrl:
			transformCloudinaryUrl(buildMediaUrl(post.repostOf?.user?.avatar), {
				width: 48,
				height: 48,
				crop: "fill",
			}) ?? null,
		repostImageUrl:
			transformCloudinaryUrl(repostImageRawUrl, {
				width: 640,
				crop: "limit",
				quality: "auto:eco",
				dpr: false,
			}) ?? null,
		repostImageSrcSet: buildResponsiveCloudinarySrcSet(repostImageRawUrl, [256, 384, 512, 640], {
			crop: "limit",
			quality: "auto:eco",
		}),
	};
};
