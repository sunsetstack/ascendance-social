import { Box, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import RichText from "../RichText";

interface PostCardBodyProps {
	body?: string;
	hasImage: boolean;
}

export const PostCardBody: React.FC<PostCardBodyProps> = ({ body, hasImage }) => {
	const { t } = useTranslation();
	const [isExpanded, setIsExpanded] = useState(false);

	if (!body) {
		return null;
	}

	return (
		<Typography
			variant="body1"
			sx={{
				color: "text.primary",
				lineHeight: 1.5,
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				mb: hasImage ? 0.5 : 0,
				fontSize: "1.125rem",
			}}
		>
			<RichText
				text={isExpanded || body.length <= 280 ? body : `${body.slice(0, 280)}...`}
			/>
			{body.length > 280 && !isExpanded && (
				<Box
					component="button"
					type="button"
					sx={{
						border: 0,
						p: 0,
						bgcolor: "transparent",
						font: "inherit",
						color: "primary.main",
						cursor: "pointer",
						ml: 0.5,
						fontWeight: 500,
						"&:hover": { textDecoration: "underline" },
						"&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
					}}
					onClick={(event) => {
						event.stopPropagation();
						setIsExpanded(true);
					}}
				>
					{t("post.show_more")}
				</Box>
			)}
		</Typography>
	);
};
