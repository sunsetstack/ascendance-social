import { useMutation, useQueryClient } from "@tanstack/react-query";
import { changePasswordRequest, deleteAccountRequest } from "../../api/userApi";

interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export const useChangePassword = () => {
  return useMutation({
    mutationFn: (payload: ChangePasswordPayload) =>
      changePasswordRequest(payload),
  });
};

export const useDeactivateAccount = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { password: string }) =>
      deleteAccountRequest(payload.password),
    onSuccess: () => {
      // The DELETE /api/users/me endpoint already clears all auth cookies and revokes
      // sessions server-side, so a separate logout API call is redundant.
      // Clear the React Query cache directly.
      queryClient.clear();

      // Signal the Axios interceptor to skip its token-refresh attempt on the
      // very first 401 that comes back after the page reloads (GET /api/users/me
      // will 401 because there is no longer a session).
      sessionStorage.setItem("account_deleted", "1");

      window.location.href = "/";
    },
  });
};
