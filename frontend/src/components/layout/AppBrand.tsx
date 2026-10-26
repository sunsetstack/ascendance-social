import { Box, IconButton, Typography } from "@mui/material";
import { Zap } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface AppBrandProps {
	onMenuClick?: () => void;
	rail?: boolean;
}

export default function AppBrand({ onMenuClick, rail = false }: AppBrandProps): React.ReactElement {
	const { t } = useTranslation();
	const markSx = {
		width: 38, height: 38, borderRadius: 3, bgcolor: "primary.main", color: "primary.contrastText",
		display: "grid", placeItems: "center", flexShrink: 0,
	};
	return (
		<Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexShrink: 0 }}>
			{onMenuClick ? (
				<IconButton aria-label={t("timeline.open_navigation")} onClick={onMenuClick} sx={{ ...markSx, "&:hover": { bgcolor: "primary.light", color: "primary.contrastText" } }}>
					<Zap size={23} strokeWidth={1.6} />
				</IconButton>
			) : (
				<Box component={RouterLink} to="/" aria-label="Ascendance" sx={markSx}><Zap size={23} strokeWidth={1.6} /></Box>
			)}
			<Typography component={RouterLink} to="/" sx={{ display: rail ? { md: "none", lg: "block" } : "block", fontWeight: 700, fontSize: { xs: "1.25rem", sm: "1.5rem" }, letterSpacing: "-0.04em", color: "text.primary", textDecoration: "none" }}>
				Ascendance
			</Typography>
		</Box>
	);
}
