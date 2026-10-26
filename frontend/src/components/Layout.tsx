import React, { lazy, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTheme, useMediaQuery } from "@mui/material";
import { useAuth } from "../hooks/context/useAuth";
import { useEmailVerificationLock } from "../hooks/layout/useEmailVerificationLock";

const loadMobileLayout = () => import("./mobile/MobileLayout");
const initialMobileLayout = window.matchMedia("(max-width: 899.95px)").matches
	? loadMobileLayout()
	: undefined;
const MobileLayout = lazy(() => initialMobileLayout ?? loadMobileLayout());
const DesktopAppShell = lazy(() =>
	import("./layout/DesktopAppShell").then((module) => ({ default: module.DesktopAppShell })),
);
const InterestsOnboarding = lazy(() => import("./InterestsOnboarding"));

const Layout: React.FC = () => {
	const theme = useTheme();
	const location = useLocation();
	const navigate = useNavigate();
	const isMobile = useMediaQuery(theme.breakpoints.down("md"));
	const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
	const { user } = useAuth();
	const { shouldLockToVerification } = useEmailVerificationLock();

	const isMessagesPage = location.pathname.startsWith("/messages");
	const isAdminPage = location.pathname.startsWith("/admin");
	const isSettingsPage = location.pathname.startsWith("/settings");

	const handleOpenUploadModal = () => {
		if (!user) {
			navigate("/login");
			return;
		}
		setIsUploadModalOpen(true);
	};
	const handleCloseUploadModal = () => setIsUploadModalOpen(false);

	const isAuthPage = ["/login", "/register", "/forgot-password", "/reset-password"].includes(location.pathname.replace(/\/$/, ""));
	if (shouldLockToVerification && !isAuthPage) {
		const email = user && "email" in user ? user.email : "";
		const search = email ? `?email=${encodeURIComponent(email)}` : "";
		return <Navigate to={`/verify-email${search}`} replace />;
	}

	const showOnboarding = user && !isAuthPage;

	return (
		<>
			{showOnboarding && <InterestsOnboarding key={user?.publicId} />}
			{isMobile ? <MobileLayout /> : (
				<DesktopAppShell
					isMessagesPage={isMessagesPage}
					isAdminPage={isAdminPage}
					isSettingsPage={isSettingsPage}
					isUploadModalOpen={isUploadModalOpen}
					onCloseUploadModal={handleCloseUploadModal}
					onOpenUploadModal={handleOpenUploadModal}
				/>
			)}
		</>
	);
};

export default Layout;
