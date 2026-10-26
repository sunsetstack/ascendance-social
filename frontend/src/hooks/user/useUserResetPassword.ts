import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resetPassword } from "../../api/userApi";

export const useResetPassword = () => {
	const queryClient = useQueryClient();
	return useMutation<void, Error, { token: string; newPassword: string }>({
		mutationFn: resetPassword,
		onSuccess: () => {
			queryClient.setQueryData(["currentUser"], null);
			return queryClient.invalidateQueries({ queryKey: ["currentUser"] });
		},
	});
};
