import { useMutation } from "@tanstack/react-query";
import { registerRequest, RegisterResponse } from "../../api/userApi";
import { toast } from "react-toastify";
import { useAuth } from "../context/useAuth";
import { devError } from "@/lib/devLogger";

export const useRegister = () => {
	const { login: setAuthUser } = useAuth();

	return useMutation<RegisterResponse, Error, { handle: string; username: string; email: string; password: string }>({
		mutationFn: registerRequest,

		onSuccess: (data) => {
			setAuthUser(data.user);
			toast.success("Registration successful! Check your email to verify your account.");
		},

		onError: (error) => {
			toast.error(`Registration failed: ${error.message || "Could not create account"}`);
			devError("Registration mutation failed:", error);
		},
	});
};
