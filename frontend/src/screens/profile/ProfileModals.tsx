import { Modal, Paper, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { Id } from "react-toastify";
import { EditProfile } from "../../components/EditProfile";
import ImageEditor from "../../components/ImageEditor";
import { PublicUserDTO } from "../../types";

interface ProfileModalsProps {
	isAvatarModalOpen: boolean;
	isCoverModalOpen: boolean;
	isEditProfileOpen: boolean;
	initialData: PublicUserDTO;
	onCloseAvatarModal: () => void;
	onCloseCoverModal: () => void;
	onCloseEditProfile: () => void;
	onAvatarUpload: (croppedImage: Blob | null) => void;
	onCoverUpload: (croppedImage: Blob | null) => void;
	notifySuccess: (message: string) => Id;
	notifyError: (message: string) => Id;
}

export const ProfileModals: React.FC<ProfileModalsProps> = ({
	isAvatarModalOpen,
	isCoverModalOpen,
	isEditProfileOpen,
	initialData,
	onCloseAvatarModal,
	onCloseCoverModal,
	onCloseEditProfile,
	onAvatarUpload,
	onCoverUpload,
	notifySuccess,
	notifyError,
}) => {
	const { t } = useTranslation();

	return (
		<>
			<Modal
				open={isAvatarModalOpen}
				onClose={onCloseAvatarModal}
				sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}
			>
				<Paper sx={{ p: 3, borderRadius: 4, maxWidth: 500, width: "100%" }}>
					<Typography variant="h6" gutterBottom fontWeight={700}>
						{t("profile.update_avatar")}
					</Typography>
					<ImageEditor type="avatar" onImageUpload={onAvatarUpload} onClose={onCloseAvatarModal} />
				</Paper>
			</Modal>

			<Modal
				open={isCoverModalOpen}
				onClose={onCloseCoverModal}
				sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}
			>
				<Paper sx={{ p: 3, borderRadius: 4, maxWidth: 600, width: "100%" }}>
					<Typography variant="h6" gutterBottom fontWeight={700}>
						{t("profile.update_cover")}
					</Typography>
					<ImageEditor type="cover" aspectRatio={3} onImageUpload={onCoverUpload} onClose={onCloseCoverModal} />
				</Paper>
			</Modal>

			<Modal
				open={isEditProfileOpen}
				onClose={onCloseEditProfile}
				sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}
			>
				<Paper sx={{ p: 3, borderRadius: 4, maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
					<Typography variant="h6" gutterBottom fontWeight={700}>
						{t("profile.edit_profile")}
					</Typography>
					<EditProfile
						onComplete={onCloseEditProfile}
						notifySuccess={notifySuccess}
						notifyError={notifyError}
						initialData={initialData}
					/>
				</Paper>
			</Modal>
		</>
	);
};
