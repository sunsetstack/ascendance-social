import { useAuth } from "../context/useAuth";

export const useEmailVerificationLock = () => {
	const { user } = useAuth();
	const isEmailVerified = user
		? !("isEmailVerified" in user) || user.isEmailVerified !== false
		: true;

	return {
		shouldLockToVerification: !!user && !isEmailVerified,
	};
};
