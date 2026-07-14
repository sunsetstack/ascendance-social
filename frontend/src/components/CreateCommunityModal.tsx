import React, { useEffect, useState } from "react";
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	TextField,
	Button,
	Box,
	Typography,
	Avatar,
	IconButton,
} from "@mui/material";
import { PhotoCamera, Delete as DeleteIcon } from "@mui/icons-material";
import { useCreateCommunity } from "../hooks/communities/useCommunity";

interface CreateCommunityModalProps {
	open: boolean;
	onClose: () => void;
}

const CreateCommunityModal: React.FC<CreateCommunityModalProps> = ({ open, onClose }) => {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [avatarFile, setAvatarFile] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const { mutate: createCommunity, isPending } = useCreateCommunity();

	useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [previewUrl]);

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (event.target.files && event.target.files[0]) {
			const file = event.target.files[0];
			setAvatarFile(file);
			setPreviewUrl(URL.createObjectURL(file));
		}
	};

	const handleRemoveAvatar = () => {
		setAvatarFile(null);
		setPreviewUrl(null);
	};

	const handleSubmit = () => {
		createCommunity(
			{ name, description, avatar: avatarFile || undefined },
			{
				onSuccess: () => {
					onClose();
					setName("");
					setDescription("");
					handleRemoveAvatar();
				},
			}
		);
	};

	return (
		<Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
			<DialogTitle>Create a New Community</DialogTitle>
			<DialogContent>
				<Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 2 }}>
					<Box sx={{ position: "relative" }}>
						<Avatar src={previewUrl || undefined} sx={{ width: 80, height: 80, mb: 1 }}>
							{!previewUrl && name.charAt(0).toUpperCase()}
						</Avatar>
						{previewUrl && (
							<IconButton
								size="small"
								sx={{
									position: "absolute",
									top: -5,
									right: -5,
									bgcolor: "background.paper",
									"&:hover": { bgcolor: "error.light", color: "white" },
								}}
								onClick={handleRemoveAvatar}
							>
								<DeleteIcon fontSize="small" />
							</IconButton>
						)}
					</Box>
					<Button variant="outlined" component="label" startIcon={<PhotoCamera />} size="small">
						Upload Icon
						<input hidden accept="image/*" type="file" onChange={handleFileChange} />
					</Button>
					<Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
						Optional
					</Typography>
				</Box>

				<TextField
					autoFocus
					margin="dense"
					label="Community Name"
					fullWidth
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				<TextField
					margin="dense"
					label="Description"
					fullWidth
					multiline
					rows={4}
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose}>Cancel</Button>
				<Button onClick={handleSubmit} variant="contained" disabled={isPending || !name.trim()}>
					{isPending ? "Creating..." : "Create"}
				</Button>
			</DialogActions>
		</Dialog>
	);
};

export default CreateCommunityModal;
