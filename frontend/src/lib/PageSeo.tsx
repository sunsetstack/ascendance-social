import { Helmet } from "react-helmet-async";
import {
	DEFAULT_DESCRIPTION,
	DEFAULT_IMAGE,
	DEFAULT_TITLE,
	type SeoMetadata,
	buildAbsoluteUrl,
	normalizeText,
	truncate,
} from "./seo";

export const PageSeo = ({
	title,
	description,
	path = "/",
	image,
	type = "website",
	noindex,
	keywords,
}: SeoMetadata) => {
	const resolvedTitle = title || DEFAULT_TITLE;
	const resolvedDescription = truncate(normalizeText(description, DEFAULT_DESCRIPTION));
	const canonicalUrl = buildAbsoluteUrl(path);
	const imageUrl = buildAbsoluteUrl(image || DEFAULT_IMAGE);
	const robots = noindex
		? "noindex,nofollow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"
		: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

	return (
		<Helmet prioritizeSeoTags>
			<title>{resolvedTitle}</title>
			<meta name="description" content={resolvedDescription} />
			<meta name="robots" content={robots} />
			{keywords ? <meta name="keywords" content={keywords} /> : null}
			<link rel="canonical" href={canonicalUrl} />

			<meta property="og:type" content={type} />
			<meta property="og:site_name" content="Ascendance Social" />
			<meta property="og:title" content={resolvedTitle} />
			<meta property="og:description" content={resolvedDescription} />
			<meta property="og:url" content={canonicalUrl} />
			<meta property="og:image" content={imageUrl} />

			<meta name="twitter:card" content="summary_large_image" />
			<meta name="twitter:title" content={resolvedTitle} />
			<meta name="twitter:description" content={resolvedDescription} />
			<meta name="twitter:image" content={imageUrl} />
		</Helmet>
	);
};
