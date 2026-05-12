import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Box, Button, Container, Paper, TextField, Typography } from "@mui/material";
import { useResetPassword } from "../hooks/user/useUserResetPassword";
import { devError } from "@/lib/devLogger";

const ResetPassword = () => {
	const [searchParams] = useSearchParams();
	const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);

	const [newPassword, setNewPassword] = useState<string>("");
	const [confirmPassword, setConfirmPassword] = useState<string>("");
	const [newPasswordError, setNewPasswordError] = useState<string>("");
	const [confirmPasswordError, setConfirmPasswordError] = useState<string>("");
	const [errorMessage, setErrorMessage] = useState<string>("");

	const { mutateAsync: reset, isPending, isSuccess } = useResetPassword();

	const validateNewPassword = (value: string) => {
		if (!value.trim()) return "New password is required";
		if (value.length < 8) return "Password must be at least 8 characters";
		return "";
	};

	const validateConfirmPassword = (value: string) => {
		if (!value.trim()) return "Confirm password is required";
		if (value !== newPassword) return "Passwords do not match";
		return "";
	};

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setErrorMessage("");

		if (!token) {
			setErrorMessage("Reset token is missing or invalid");
			return;
		}

		const newPasswordValidation = validateNewPassword(newPassword);
		const confirmPasswordValidation = validateConfirmPassword(confirmPassword);
		setNewPasswordError(newPasswordValidation);
		setConfirmPasswordError(confirmPasswordValidation);
		if (newPasswordValidation || confirmPasswordValidation) return;

		try {
			await reset({ token, newPassword });
		} catch (error) {
			devError("Reset password error:", error);
			setErrorMessage(error instanceof Error ? error.message : "An error occurred. Please try again.");
		}
	};

	return (
		<Container maxWidth="sm" sx={{ mt: 8 }}>
			<Paper elevation={3} sx={{ p: 4, display: "flex", flexDirection: "column", alignItems: "center" }}>
				<Typography component="h1" variant="h5" sx={{ mb: 2 }}>
					Reset Password
				</Typography>

				{isSuccess ? (
					<Box sx={{ width: "100%", textAlign: "center" }}>
						<Alert severity="success" sx={{ mb: 2 }}>
							Your password has been reset successfully.
						</Alert>
						<Button component={Link} to="/login" variant="contained" fullWidth>
							Return to Login
						</Button>
					</Box>
				) : (
					<Box component="form" onSubmit={onSubmit} sx={{ mt: 1, width: "100%" }}>
						<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
							Enter a new password for your account.
						</Typography>

						{!!errorMessage && (
							<Alert severity="error" sx={{ mb: 2 }}>
								{errorMessage}
							</Alert>
						)}

						{!token && (
							<Alert severity="warning" sx={{ mb: 2 }}>
								This reset link is missing a token.
							</Alert>
						)}

						<TextField
							margin="normal"
							required
							fullWidth
							id="newPassword"
							label="New Password"
							type="password"
							autoComplete="new-password"
							value={newPassword}
							onChange={(e) => {
								setNewPassword(e.target.value);
								if (newPasswordError) setNewPasswordError("");
								if (confirmPasswordError) setConfirmPasswordError("");
							}}
							onBlur={() => setNewPasswordError(validateNewPassword(newPassword))}
							error={!!newPasswordError}
							helperText={newPasswordError}
						/>

						<TextField
							margin="normal"
							required
							fullWidth
							id="confirmPassword"
							label="Confirm Password"
							type="password"
							autoComplete="new-password"
							value={confirmPassword}
							onChange={(e) => {
								setConfirmPassword(e.target.value);
								if (confirmPasswordError) setConfirmPasswordError("");
							}}
							onBlur={() => setConfirmPasswordError(validateConfirmPassword(confirmPassword))}
							error={!!confirmPasswordError}
							helperText={confirmPasswordError}
						/>

						<Button type="submit" fullWidth variant="contained" sx={{ mt: 3, mb: 2 }} disabled={isPending || !token}>
							{isPending ? "Resetting..." : "Reset Password"}
						</Button>

						<Box sx={{ textAlign: "center" }}>
							<Link to="/login" style={{ textDecoration: "none" }}>
								<Typography variant="body2" color="primary">
									Back to Login
								</Typography>
							</Link>
						</Box>
					</Box>
				)}
			</Paper>
		</Container>
	);
};

export default ResetPassword;
