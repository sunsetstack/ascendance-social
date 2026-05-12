import { useMutation, useQueryClient } from "@tanstack/react-query";
import { loginRequest, LoginResponse } from "../../api/userApi";
import { toast } from "react-toastify";
import { useAuth } from "../context/useAuth";
import { devError } from "@/lib/devLogger";

export const useLogin = () => {
	const queryClient = useQueryClient();
	const { login: setAuthUser } = useAuth();

	return useMutation<LoginResponse, Error, { email: string; password: string }>({
		mutationFn: loginRequest,

		onSuccess: (data) => {
			setAuthUser(data.user);

			queryClient.invalidateQueries({ queryKey: ["user", data.user.publicId] });
			queryClient.invalidateQueries({ queryKey: ["userImages", data.user.publicId] });
			queryClient.invalidateQueries({ queryKey: ["personalizedFeed"] });

			toast.success("Login successful!");
		},

		onError: (error) => {
			console.log(error);
			toast.error(`Login failed: ${error.message || "Invalid credentials or server error"}`);
			devError("Login mutation failed:", error);
		},
	});
};
