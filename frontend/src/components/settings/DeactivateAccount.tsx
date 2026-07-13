import { isAxiosError } from "axios";
import { useState } from "react";
import {
	Box,
	Typography,
	IconButton,
	TextField,
	Button,
	Alert,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogContentText,
	DialogActions,
	useTheme,
	alpha,
} from "@mui/material";
import { ArrowBack as ArrowBackIcon, Warning as WarningIcon } from "@mui/icons-material";
import { useDeactivateAccount } from "../../hooks/settings";

interface DeactivateAccountProps {
	onBack: () => void;
}

const DeactivateAccount = ({ onBack }: DeactivateAccountProps) => {
	const theme = useTheme();
	const [password, setPassword] = useState("");
	const [reason, setReason] = useState("");
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const deactivateAccount = useDeactivateAccount();

	const handleDeactivate = async () => {
		setError(null);

		try {
			await deactivateAccount.mutateAsync({ password, reason: reason.trim() });
		} catch (err: unknown) {
			const message = isAxiosError<{ error?: string }>(err)
				? (err.response?.data?.error ?? "Failed to delete account")
				: "Failed to delete account";
			setError(message);
			setConfirmOpen(false);
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
					Delete Account
				</Typography>
			</Box>

			{/* warning box */}
			<Box
				sx={{
					p: 3,
					mb: 3,
					borderRadius: 2,
					bgcolor: alpha(theme.palette.error.main, 0.1),
					border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
				}}
			>
				<Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
					<WarningIcon sx={{ color: "error.main", mt: 0.5 }} />
					<Box>
						<Typography variant="subtitle1" fontWeight={700} color="error.main" sx={{ mb: 1 }}>
							This action is permanent
						</Typography>
						<Typography variant="body2" color="text.secondary">
							Deleting your account permanently removes your profile and social data. The following rules apply:
						</Typography>
						<Box component="ul" sx={{ mt: 1, pl: 2, color: "text.secondary" }}>
							<Typography component="li" variant="body2">Your profile and account information</Typography>
							<Typography component="li" variant="body2">All your posts and images</Typography>
							<Typography component="li" variant="body2">Your likes, favorites, follows, and other interactions are removed</Typography>
							<Typography component="li" variant="body2">Your comments remain only as an anonymous account-deleted notice</Typography>
							<Typography component="li" variant="body2">Messages and conversations remain for the other participants, without your identity</Typography>
							<Typography component="li" variant="body2">Your followers and following lists</Typography>
						</Box>
					</Box>
				</Box>
			</Box>

			{error && (
				<Alert severity="error" sx={{ mb: 2 }}>
					{error}
				</Alert>
			)}

			<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
				To confirm account deletion, enter your password:
			</Typography>

			<TextField
				fullWidth
				type="password"
				label="Your Password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				sx={{ mb: 3 }}
			/>

			<TextField
				fullWidth
				multiline
				minRows={3}
				label="Why are you deleting your account?"
				value={reason}
				onChange={(e) => setReason(e.target.value)}
				inputProps={{ maxLength: 500 }}
				helperText="Required. This reason is retained in the security audit trail."
				sx={{ mb: 3 }}
			/>

			<Button
				variant="contained"
				color="error"
				fullWidth
				disabled={!password || !reason.trim()}
				onClick={() => setConfirmOpen(true)}
				sx={{ borderRadius: 9999, py: 1.5 }}
			>
				Delete Account
			</Button>

			{/* confirmation dialog */}
			<Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
				<DialogTitle>Are you absolutely sure?</DialogTitle>
				<DialogContent>
					<DialogContentText>
						This action cannot be undone. Your account and owned content will be removed; comments and conversations remain only in their anonymized forms for other participants.
					</DialogContentText>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
					<Button
						onClick={handleDeactivate}
						color="error"
						variant="contained"
						disabled={deactivateAccount.isPending}
					>
						{deactivateAccount.isPending ? "Deleting..." : "Yes, delete my account"}
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
};

export default DeactivateAccount;
