import { useState } from "react";
import {
	Box,
	Typography,
	IconButton,
	TextField,
	Button,
	Alert,
} from "@mui/material";
import { ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import { useChangePassword } from "../../hooks/settings";

interface ChangePasswordProps {
	onBack: () => void;
}

const ChangePassword = ({ onBack }: ChangePasswordProps) => {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);

	const changePassword = useChangePassword();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setSuccess(false);

		if (newPassword !== confirmPassword) {
			setError("New passwords do not match");
			return;
		}

		if (newPassword.length < 8) {
			setError("New password must be at least 8 characters");
			return;
		}

		try {
			await changePassword.mutateAsync({ currentPassword, newPassword });
			setSuccess(true);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err: unknown) {
			const fallbackMessage = "Failed to change password";
			if (
				err &&
				typeof err === "object" &&
				"response" in err &&
				err.response &&
				typeof err.response === "object" &&
				"data" in err.response &&
				err.response.data &&
				typeof err.response.data === "object" &&
				"error" in err.response.data &&
				typeof err.response.data.error === "string"
			) {
				setError(err.response.data.error);
			} else {
				setError(fallbackMessage);
			}
		}
	};

	return (
		<Box>
			{/* header */}
			<Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
				<IconButton onClick={onBack} size="small">
					<ArrowBackIcon />
				</IconButton>
				<Typography variant="h6" fontWeight={700}>
					Change Password
				</Typography>
			</Box>

			<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
				Your password must be at least 8 characters and should be different from your current password.
			</Typography>

			{error && (
				<Alert severity="error" sx={{ mb: 2 }}>
					{error}
				</Alert>
			)}

			{success && (
				<Alert severity="success" sx={{ mb: 2 }}>
					Password changed successfully
				</Alert>
			)}

			<Box component="form" onSubmit={handleSubmit}>
				<TextField
					fullWidth
					type="password"
					label="Current Password"
					value={currentPassword}
					onChange={(e) => setCurrentPassword(e.target.value)}
					sx={{ mb: 2 }}
					required
				/>
				<TextField
					fullWidth
					type="password"
					label="New Password"
					value={newPassword}
					onChange={(e) => setNewPassword(e.target.value)}
					sx={{ mb: 2 }}
					required
					helperText="Must be at least 8 characters"
				/>
				<TextField
					fullWidth
					type="password"
					label="Confirm New Password"
					value={confirmPassword}
					onChange={(e) => setConfirmPassword(e.target.value)}
					sx={{ mb: 3 }}
					required
				/>

				<Button
					type="submit"
					variant="contained"
					fullWidth
					disabled={changePassword.isPending || !currentPassword || !newPassword || !confirmPassword}
					sx={{ borderRadius: 9999, py: 1.5 }}
				>
					{changePassword.isPending ? "Changing..." : "Change Password"}
				</Button>
			</Box>
		</Box>
	);
};

export default ChangePassword;
