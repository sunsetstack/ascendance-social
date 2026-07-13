import React from "react";
import { useRegister } from "../hooks/user/useUserRegister";
import AuthForm from "../components/AuthForm";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { Box, Container } from "@mui/material";
import { RegisterForm } from "../types";

const Register: React.FC = () => {
	const { mutate: registerMutation, isPending } = useRegister();

	const handleRegister = async (formData: RegisterForm) => {
		registerMutation(formData);
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
				<AuthForm<RegisterForm>
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
			</Container>
			<ToastContainer position="bottom-right" autoClose={3000} theme="dark" />
		</Box>
	);
};

export default Register;
