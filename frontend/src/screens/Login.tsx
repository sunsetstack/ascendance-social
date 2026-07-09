import React, { useEffect } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useLogin } from "../hooks/user/useUserLogin";
import AuthForm from "../components/AuthForm";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Box, Container, Link, Typography } from "@mui/material";

const Login: React.FC = () => {
	const navigate = useNavigate();
	const { mutate: loginMutation, isPending, data } = useLogin();

	useEffect(() => {
		if (data?.user) {
			const isVerified = data.user.isEmailVerified !== false;
			const destination = isVerified ? "/" : `/verify-email?email=${encodeURIComponent(data.user.email)}`;
			const timer = setTimeout(() => navigate(destination), 1000);
			return () => clearTimeout(timer);
		}
	}, [data, navigate]);

	const handleLogin = (formData: { email: string; password: string }) => {
		loginMutation(formData);
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
				<AuthForm
					title="Sign In"
					fields={[
						{ name: "email", label: "Email Address", type: "email", autoComplete: "email", required: true },
						{ name: "password", label: "Password", type: "password", autoComplete: "current-password", required: true },
					]}
					onSubmit={handleLogin}
					isSubmitting={isPending}
					submitButtonText="Sign In"
					linkText="Don't have an account? Sign Up"
					linkTo="/register"
				/>
				<Box sx={{ mt: 2, textAlign: "center" }}>
					<Link component={RouterLink} to="/forgot-password" underline="hover">
						<Typography variant="body2">Forgot your password?</Typography>
					</Link>
				</Box>
			</Container>
			<ToastContainer />
		</Box>
	);
};

export default Login;
