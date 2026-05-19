import { Box, Button, CircularProgress, Typography, alpha, useTheme } from "@mui/material";
import { PageSeo } from "../../lib/PageSeo";
import type { SeoMetadata } from "../../lib/seo";

interface ProfileStateProps {
	seoMetadata: SeoMetadata;
}

interface ProfileMissingStateProps extends ProfileStateProps {
	onGoHome: () => void;
}

export const ProfileLoadingState: React.FC<ProfileStateProps> = ({ seoMetadata }) => {
	return (
		<>
			<PageSeo {...seoMetadata} />
			<Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "calc(100vh - 64px)" }}>
				<CircularProgress />
			</Box>
		</>
	);
};

export const ProfileErrorState: React.FC<ProfileStateProps> = ({ seoMetadata }) => {
	return (
		<>
			<PageSeo {...seoMetadata} />
			<Box sx={{ p: 3, textAlign: "center" }}>
				<Typography color="error">We couldn&apos;t load this profile right now.</Typography>
			</Box>
		</>
	);
};

export const ProfileMissingState: React.FC<ProfileMissingStateProps> = ({
	seoMetadata,
	onGoHome,
}) => {
	const theme = useTheme();

	return (
		<>
			<PageSeo {...seoMetadata} />
			<Box
				sx={{
					p: { xs: 3, md: 6 },
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					minHeight: "60vh",
					textAlign: "center",
				}}
			>
				<Box
					sx={{
						maxWidth: 420,
						px: 3,
						py: 4,
						borderRadius: 4,
						border: `1px solid ${theme.palette.divider}`,
						bgcolor: alpha(theme.palette.background.default, 0.9),
						boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
					}}
				>
					<Typography variant="h5" fontWeight={800} gutterBottom>
						This profile doesn&apos;t exist
					</Typography>
					<Typography variant="body2" color="text.secondary">
						The handle might be wrong or the user has left
					</Typography>
					<Button variant="contained" sx={{ mt: 3, borderRadius: 9999, px: 3 }} onClick={onGoHome}>
						Go home
					</Button>
				</Box>
			</Box>
		</>
	);
};
