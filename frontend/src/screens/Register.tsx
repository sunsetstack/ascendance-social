import React, { useState } from "react";
import { useRegister } from "../hooks/user/useUserRegister";
import { useVerifyEmail } from "../hooks/user/useVerifyEmail";
import AuthForm from "../components/AuthForm";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Alert, Box, Button, Container, TextField, Typography } from "@mui/material";
import { RegisterForm } from "../types";

const Register: React.FC = () => {
	const { mutate: registerMutation, isPending, data } = useRegister();
	const { mutate: verifyEmail, isPending: isVerifying, isSuccess, error } = useVerifyEmail();
	const [verificationCode, setVerificationCode] = useState("");

	const pendingVerification = data?.user?.isEmailVerified === false;
	const verificationEmail = data?.user?.email || "";

	const handleRegister = async (formData: { handle: string; username: string; email: string; password: string }) => {
		registerMutation(formData);
	};

	const handleVerify = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!verificationEmail || !verificationCode) return;
		verifyEmail({ email: verificationEmail, token: verificationCode });
	};

	return (
		<Box
			sx={{
				flexGrow: 1,
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				alignItems: "center",
				py: 4,
				width: "100%",
			}}
		>
			<Container maxWidth="xs">
				{pendingVerification ? (
					<Box>
						<Typography variant="h5" sx={{ mb: 2, textAlign: "center" }}>
							Verify your email
						</Typography>

						{isSuccess && (
							<Alert severity="success" sx={{ mb: 2 }}>
								Your email is verified
							</Alert>
						)}

						{error && (
							<Alert severity="error" sx={{ mb: 2 }}>
								{error.message || "Verification failed"}
							</Alert>
						)}

						<form onSubmit={handleVerify}>
							<TextField
								label="Verification code"
								value={verificationCode}
								onChange={(event) => setVerificationCode(event.target.value)}
								fullWidth
								required
								inputProps={{ inputMode: "numeric", pattern: "\\d{5}" }}
								sx={{ mb: 2 }}
							/>
							<Button type="submit" variant="contained" fullWidth disabled={isVerifying || !verificationEmail}>
								Verify email
							</Button>
						</form>
					</Box>
				) : (
					<AuthForm<RegisterForm> // add RegisterForm type in order to give TS a concrete `T` type and use confirmPassword field
						title="Create Account"
						fields={[
							{ name: "handle", label: "Handle", type: "text", autoComplete: "username", required: true },
							{ name: "username", label: "Username", type: "text", autoComplete: "username", required: true },
							{ name: "email", label: "Email Address", type: "email", autoComplete: "email", required: true },
							{ name: "password", label: "Password", type: "password", autoComplete: "new-password", required: true },
							{
								name: "confirmPassword",
								label: "Confirm Password",
								type: "password",
								autoComplete: "new-password",
								required: true,
							},
						]}
						onSubmit={handleRegister}
						isSubmitting={isPending}
						submitButtonText="Sign Up"
						linkText="Already have an account? Sign In"
						linkTo="/login"
					/>
				)}
			</Container>
			<ToastContainer position="bottom-right" autoClose={3000} theme="dark" />
		</Box>
	);
};

export default Register;
