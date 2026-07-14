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
				mt: 1.5,
				borderRadius: 3.5,
				overflow: "hidden",
				border: "1px solid",
				borderColor: "divider",
				width: "100%",
				maxHeight: "600px",
				display: "flex",
				justifyContent: "center",
				bgcolor: "#05070a",
			}}
		>
			<img
				src={imageUrl}
				srcSet={srcSet}
				width={width}
				height={height}
				sizes="(max-width: 600px) calc(100vw - 64px), 553px"
				alt={alt}
				loading={prioritizeImage ? "eager" : "lazy"}
				fetchPriority={prioritizeImage ? "high" : "auto"}
				decoding="async"
				style={{
					width: "100%",
					height: "auto",
					maxHeight: "600px",
					objectFit: "cover",
					display: "block",
				}}
			/>
		</Box>
	);
};
