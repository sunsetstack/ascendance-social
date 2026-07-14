const BASE_URL = "/api";
const CLOUDINARY_HOST = "res.cloudinary.com";
const CLOUDINARY_UPLOAD_SEGMENT = "/upload/";

type CloudinaryCrop = "fill" | "fit" | "limit" | "lfill" | "pad";
type CloudinaryQuality = "auto" | "auto:eco" | "auto:good" | number;
type CloudinaryDpr = "auto" | number | false;

interface CloudinaryTransformOptions {
	width?: number;
	height?: number;
	crop?: CloudinaryCrop;
	quality?: CloudinaryQuality;
	dpr?: CloudinaryDpr;
}

const normalizeSize = (value?: number): number | undefined => {
	if (!value || Number.isNaN(value)) return undefined;
	const rounded = Math.round(value);
	return rounded > 0 ? rounded : undefined;
};

export const buildMediaUrl = (value?: string): string | undefined => {
	if (!value) return undefined;
	if (value.startsWith("http")) return value;
	if (value.startsWith("/api/")) return value;
	return value.startsWith("/") ? `${BASE_URL}${value}` : `${BASE_URL}/${value}`;
};

export const isCloudinaryUrl = (url?: string): boolean =>
	!!url && url.includes(CLOUDINARY_HOST) && url.includes(CLOUDINARY_UPLOAD_SEGMENT);

export const transformCloudinaryUrl = (url: string | undefined, options: CloudinaryTransformOptions = {}): string | undefined => {
	if (!url || !isCloudinaryUrl(url)) return url;

	const [head, tail] = url.split(CLOUDINARY_UPLOAD_SEGMENT);
	if (!head || !tail) return url;
	if (tail.startsWith("s--")) return url;

	const width = normalizeSize(options.width);
	const height = normalizeSize(options.height);
	const quality = options.quality ?? "auto";
	const crop = options.crop ?? (width || height ? "limit" : undefined);
	const dpr =
		options.dpr === false
			? undefined
			: typeof options.dpr === "number"
				? options.dpr > 0
					? `dpr_${options.dpr}`
					: "dpr_auto"
				: "dpr_auto";

	const transforms = [
		"f_auto",
		`q_${quality}`,
		dpr,
		width ? `w_${width}` : undefined,
		height ? `h_${height}` : undefined,
		crop ? `c_${crop}` : undefined,
	].filter(Boolean);

	if (!transforms.length) return url;
	return `${head}${CLOUDINARY_UPLOAD_SEGMENT}${transforms.join(",")}/${tail}`;
};

export const buildAvatarUrl = (value: string | undefined, size: number): string | undefined =>
	transformCloudinaryUrl(buildMediaUrl(value), {
		width: size,
		height: size,
		crop: "fill",
		quality: "auto:eco",
	});

export const buildResponsiveCloudinarySrcSet = (
	url: string | undefined,
	widths: number[],
	options: Omit<CloudinaryTransformOptions, "width"> = {},
): string | undefined => {
	if (!url || !isCloudinaryUrl(url)) return undefined;

	const candidates = Array.from(new Set(widths))
		.map((width) => Math.round(width))
		.filter((width) => width > 0)
		.sort((a, b) => a - b)
		.map((width) => {
			const transformed = transformCloudinaryUrl(url, { ...options, width, dpr: options.dpr ?? false });
			return transformed ? `${transformed} ${width}w` : undefined;
		})
		.filter(Boolean);

	return candidates.length ? candidates.join(", ") : undefined;
};
