import { useState } from "react";
import { Link } from "react-router-dom";
import { Box, Button, Container, TextField, Typography, Alert, Paper } from "@mui/material";
import { useForgotPassword } from "../hooks/user/useUserForgotPassword";
import { devError } from "@/lib/devLogger";

const ForgotPassword = () => {
	const [email, setEmail] = useState<string>("");
	const [emailError, setEmailError] = useState<string>("");
	const [errorMessage, setErrorMessage] = useState<string>("");
	const { mutateAsync: requestReset, isPending, isSuccess } = useForgotPassword();

	const validateEmail = (value: string) => {
		if (!value.trim()) return "Email is required";
		const emailPattern = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
		if (!emailPattern.test(value)) return "Invalid email address";
		return "";
	};

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setErrorMessage("");
		const validationMessage = validateEmail(email);
		setEmailError(validationMessage);
		if (validationMessage) return;

		try {
			await requestReset({ email });
		} catch (error) {
			devError("Forgot password error:", error);
			setErrorMessage(error instanceof Error ? error.message : "An error occurred. Please try again.");
		}
	};

	return (
		<Container maxWidth="sm" sx={{ mt: 8 }}>
			<Paper elevation={3} sx={{ p: 4, display: "flex", flexDirection: "column", alignItems: "center" }}>
				<Typography component="h1" variant="h5" sx={{ mb: 2 }}>
					Forgot Password
				</Typography>

				{isSuccess ? (
					<Box sx={{ width: "100%", textAlign: "center" }}>
						<Alert severity="success" sx={{ mb: 2 }}>
							If an account with that email exists, a password reset link has been sent.
						</Alert>
						<Button component={Link} to="/login" variant="contained" fullWidth>
							Return to Login
						</Button>
					</Box>
				) : (
					<Box component="form" onSubmit={onSubmit} sx={{ mt: 1, width: "100%" }}>
						<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
							Enter your email address and we'll send you a link to reset your password.
						</Typography>

						{!!errorMessage && (
							<Alert severity="error" sx={{ mb: 2 }}>
								{errorMessage}
							</Alert>
						)}

						<TextField
							margin="normal"
							required
							fullWidth
							id="email"
							label="Email Address"
							autoComplete="email"
							autoFocus
							value={email}
							onChange={(e) => {
								setEmail(e.target.value);
								if (emailError) setEmailError("");
							}}
							onBlur={() => setEmailError(validateEmail(email))}
							error={!!emailError}
							helperText={emailError}
						/>

						<Button type="submit" fullWidth variant="contained" sx={{ mt: 3, mb: 2 }} disabled={isPending}>
							{isPending ? "Sending..." : "Send Reset Link"}
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

export default ForgotPassword;
