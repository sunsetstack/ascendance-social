import { useEffect, useState } from "react";
import { useSearchParams, Link as RouterLink } from "react-router-dom";
import { Box, Button, Container, TextField, Typography, Alert, Link } from "@mui/material";
import { useVerifyEmail } from "../hooks/user/useVerifyEmail";
import { useAuth } from "../hooks/context/useAuth";

const VerifyEmail = () => {
	const [searchParams] = useSearchParams();
	const tokenFromUrl = searchParams.get("token") ?? "";
	const [token, setToken] = useState(tokenFromUrl);
	const [autoSubmitted, setAutoSubmitted] = useState(false);
	const { user } = useAuth();

	const resolvedEmail =
		user && "email" in user && typeof user.email === "string" ? user.email : (searchParams.get("email") ?? "");

	const { mutate, isPending, isSuccess, error } = useVerifyEmail();

	useEffect(() => {
		if (resolvedEmail && tokenFromUrl && !autoSubmitted) {
			setAutoSubmitted(true);
			mutate({ email: resolvedEmail, token: tokenFromUrl });
		}
	}, [resolvedEmail, tokenFromUrl, autoSubmitted, mutate]);

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!resolvedEmail || !token) return;
		mutate({ email: resolvedEmail, token });
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

				{!resolvedEmail && (
					<Alert severity="warning" sx={{ mb: 2 }}>
						We could not detect your email. Please register again
					</Alert>
				)}

				<form onSubmit={handleSubmit}>
					<TextField
						label="Verification code"
						value={token}
						onChange={(event) => setToken(event.target.value)}
						fullWidth
						required
						inputProps={{ inputMode: "numeric", pattern: "\\d{5}" }}
						sx={{ mb: 2 }}
					/>
					<Button type="submit" variant="contained" fullWidth disabled={isPending || !resolvedEmail}>
						Verify email
					</Button>
				</form>

				<Box sx={{ mt: 2, textAlign: "center" }}>
					<Link component={RouterLink} to="/login" underline="hover">
						Return to login
					</Link>
				</Box>
			</Container>
		</Box>
	);
};

export default VerifyEmail;
