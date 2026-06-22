import React from "react";
import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";

const LanguageSwitcher: React.FC = () => {
	const { i18n } = useTranslation();

	const toggleLanguage = () => {
		const newLang = i18n.resolvedLanguage?.startsWith("bg") ? "en" : "bg";
		i18n.changeLanguage(newLang);
	};

	return (
		<Box
			component="button"
			type="button"
			onClick={toggleLanguage}
			title="Switch Language / Смени език"
			sx={{
				position: "fixed",
				bottom: 16,
				left: 16,
				zIndex: 1300,
				cursor: "pointer",
				bgcolor: "rgba(0, 0, 0, 0.2)",
				color: "common.white",
				px: 1.5,
				py: 0.5,
				border: 0,
				borderRadius: 9999,
				fontSize: "0.75rem",
				fontFamily: "monospace",
				backdropFilter: "blur(4px)",
				transition: "background-color 0.3s ease",
				"&:hover": {
					bgcolor: "rgba(0, 0, 0, 0.8)",
				},
			}}
		>
			{i18n.resolvedLanguage?.startsWith("bg") ? "🇧🇬 BG" : "🇺🇸 EN"}
		</Box>
	);
};

export default LanguageSwitcher;
