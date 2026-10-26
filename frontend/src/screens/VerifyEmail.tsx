import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { Box, Button, Container, TextField, Typography, Alert, Link } from "@mui/material";
import { useVerifyEmail } from "../hooks/user/useVerifyEmail";
import { useAuth } from "../hooks/context/useAuth";
import { resendVerificationEmail } from "../api/userApi";

const readVerificationLink = (): { email: string; token: string } => {
	const fragment = new URLSearchParams(window.location.hash.slice(1));
	const query = new URLSearchParams(window.location.search);
	return {
		email: fragment.get("email") ?? query.get("email") ?? "",
		token: fragment.get("token") ?? query.get("token") ?? "",
	};
};

const VerifyEmail = () => {
	const { search, hash } = useLocation();
	const [linkData, setLinkData] = useState(readVerificationLink);
	const tokenFromUrl = linkData.token;
	const [token, setToken] = useState(tokenFromUrl);
	const autoSubmitted = useRef("");
	const { user } = useAuth();

	const resolvedEmail =
		linkData.email || (user && "email" in user && typeof user.email === "string" ? user.email : "");

	const { mutate, isPending, isSuccess, error, reset } = useVerifyEmail();
	const resend = useMutation({
		mutationFn: resendVerificationEmail,
		onSuccess: () => { setToken(""); reset(); },
	});
	const canResend = user?.email === resolvedEmail && user?.isEmailVerified === false;

	useLayoutEffect(() => {
		if (!window.location.search && !window.location.hash) return;
		const data = readVerificationLink();
		setLinkData(data);
		setToken(data.token);
		window.history.replaceState(window.history.state, document.title, window.location.pathname);
	}, [search, hash]);

	useEffect(() => {
		const signature = `${resolvedEmail}:${tokenFromUrl}`;
		if (resolvedEmail && tokenFromUrl && autoSubmitted.current !== signature) {
			autoSubmitted.current = signature;
			mutate({ email: resolvedEmail, token: tokenFromUrl });
		}
	}, [resolvedEmail, tokenFromUrl, mutate]);

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
					<Button type="submit" variant="contained" fullWidth disabled={isPending || isSuccess || resend.isPending || !resolvedEmail}>
						Verify email
					</Button>
				</form>
				{canResend && !isSuccess && <Button fullWidth disabled={isPending || resend.isPending}
					onClick={() => resend.mutate()} sx={{ mt: 1 }}>Resend verification email</Button>}
				{resend.isSuccess && <Alert severity="success" sx={{ mt: 2 }}>A new verification email has been sent.</Alert>}
				{resend.error && <Alert severity="error" sx={{ mt: 2 }}>{resend.error.message}</Alert>}

				<Box sx={{ mt: 2, textAlign: "center" }}>
					<Link component={RouterLink} to={user?.isEmailVerified ? "/" : "/login"} underline="hover">
						{user?.isEmailVerified ? "Continue to Ascendance" : "Return to login"}
					</Link>
				</Box>
			</Container>
		</Box>
	);
};

export default VerifyEmail;
