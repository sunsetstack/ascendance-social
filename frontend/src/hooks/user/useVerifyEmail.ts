import { useMutation, useQueryClient } from "@tanstack/react-query";
import { verifyEmail } from "../../api/userApi";
import { AdminUserDTO, AuthenticatedUserDTO } from "../../types";

type VerifyEmailPayload = { email: string; token: string };

export const useVerifyEmail = () => {
	const queryClient = useQueryClient();

	return useMutation<AuthenticatedUserDTO | AdminUserDTO, Error, VerifyEmailPayload>({
		mutationFn: verifyEmail,
		onSuccess: (data) => {
			const currentUser = queryClient.getQueryData<AuthenticatedUserDTO | AdminUserDTO | null>(["currentUser"]);
			if (currentUser?.publicId === data.publicId) {
				queryClient.setQueryData(["currentUser"], data);
			}
			queryClient.invalidateQueries({ queryKey: ["currentUser"] });
		},
	});
};
