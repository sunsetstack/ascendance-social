import React, { useState, useEffect } from "react";
import { Box, TextField, Button, CircularProgress, Stack, Typography, alpha, useTheme } from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import CancelIcon from "@mui/icons-material/Cancel";
import LanguageIcon from "@mui/icons-material/Language";
import { EditProfileProps, IUser } from "../types";
import { useEditUser } from "../hooks/user/useUsers";
import { useTranslation } from "react-i18next";

export const EditProfile: React.FC<EditProfileProps> = ({ onComplete, notifySuccess, notifyError, initialData }) => {
	const { t, i18n } = useTranslation();
	const theme = useTheme();
	// State initialized from initialData
	const [username, setUsername] = useState(initialData?.username || "");
	const [bio, setBio] = useState(initialData?.bio || "");

	const toggleLanguage = () => {
		const newLang = i18n.resolvedLanguage?.startsWith("bg") ? "en" : "bg";
		i18n.changeLanguage(newLang);
	};

	useEffect(() => {
		if (initialData) {
			setUsername(initialData.username || "");
			setBio(initialData.bio || "");
		} else {
			setUsername("");
			setBio("");
		}
	}, [initialData]);

	const { mutate: editUserMutation, isPending } = useEditUser();

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!username.trim()) {
			notifyError(t("profile.username_empty"));
			return;
		}
		const updateData: Partial<IUser> = {
			username: username.trim(),
			bio: bio.trim(),
		};

		// Call mutation
		editUserMutation(updateData, {
			onSuccess: () => {
				notifySuccess(t("profile.update_success"));
				onComplete();
			},
			onError: (error: unknown) => {
				let errorMessage = "Unknown error";
				if (error && typeof error === "object" && "message" in error) {
					errorMessage = (error as { message?: string }).message || errorMessage;
				}
				notifyError(t("profile.update_failed", { error: errorMessage }));
			},
		});
	};

	return (
		/* Using Box as the form container */
		<Box component="form" onSubmit={handleSubmit} noValidate sx={{ width: "100%" }}>
			<Stack spacing={3}>
				<TextField
					fullWidth
					id="edit-username"
					label={t("profile.username")}
					name="username"
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					disabled={isPending}
				/>
				<TextField
					fullWidth
					id="edit-bio"
					label={t("profile.bio")}
					name="bio"
					multiline
					rows={4}
					value={bio}
					onChange={(e) => setBio(e.target.value)}
					disabled={isPending}
					placeholder={t("profile.bio_placeholder")}
					inputProps={{ maxLength: 200 }}
					helperText={`${bio.length}/200`}
				/>

				<Box sx={{ mt: 1 }}>
					<Typography
						variant="subtitle2"
						color="text.secondary"
						sx={{ mb: 1, display: "flex", alignItems: "center", gap: 1 }}
					>
						<LanguageIcon fontSize="small" />
						{t("nav.settings")} - {t("common.language", "Language")}
					</Typography>
					<Button
						variant="outlined"
						onClick={toggleLanguage}
						sx={{
							borderRadius: 9999,
							textTransform: "none",
							borderColor: alpha(theme.palette.divider, 0.2),
							color: theme.palette.text.primary,
							"&:hover": {
								borderColor: theme.palette.primary.main,
								backgroundColor: alpha(theme.palette.primary.main, 0.05),
							},
						}}
					>
						{i18n.resolvedLanguage?.startsWith("bg") ? "🇧🇬 Български" : "🇺🇸 English"}
					</Button>
				</Box>

				{/* Action Buttons */}
				<Stack direction={{ xs: "column", sm: "row" }} spacing={2} justifyContent="flex-end" sx={{ mt: 2 }}>
					<Button variant="outlined" onClick={onComplete} disabled={isPending} startIcon={<CancelIcon />}>
						{t("profile.cancel")}
					</Button>
					<Button
						type="submit"
						variant="contained"
						color="primary"
						disabled={isPending}
						startIcon={isPending ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
					>
						{isPending ? t("profile.saving") : t("profile.save")}
					</Button>
				</Stack>
			</Stack>
		</Box>
	);
};
