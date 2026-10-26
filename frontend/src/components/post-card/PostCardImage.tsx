import { Box } from "@mui/material";

interface PostCardImageProps {
	imageUrl: string | null;
	srcSet?: string;
	alt: string;
	width?: number;
	height?: number;
	prioritizeImage?: boolean;
}

export const PostCardImage: React.FC<PostCardImageProps> = ({
	imageUrl,
	srcSet,
	alt,
	width,
	height,
	prioritizeImage = false,
}) => {
	if (!imageUrl) {
		return null;
	}

	return (
		<Box
			sx={{
				mt: 1.25,
				borderRadius: 4,
				overflow: "hidden",
				border: "1px solid",
				borderColor: "divider",
				width: "fit-content",
				maxWidth: "100%",
				display: "flex",
				justifyContent: "center",
			}}
		>
			<img
				src={imageUrl}
				srcSet={srcSet}
				width={width}
				height={height}
				sizes="(max-width: 639px) calc(100vw - 86px), 554px"
				alt={alt}
				loading={prioritizeImage ? "eager" : "lazy"}
				{...{ fetchpriority: prioritizeImage ? "high" : "auto" }}
				decoding="async"
				style={{
					width: "auto",
					maxWidth: "100%",
					height: "auto",
					maxHeight: "420px",
					objectFit: "contain",
					display: "block",
				}}
			/>
		</Box>
	);
};
