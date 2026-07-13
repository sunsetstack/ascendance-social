import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTheme, useMediaQuery } from "@mui/material";
import { MobileLayout } from "./mobile";
import { useAuth } from "../hooks/context/useAuth";
import { useEmailVerificationLock } from "../hooks/layout/useEmailVerificationLock";
import { DesktopAppShell } from "./layout/DesktopAppShell";

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

	if (shouldLockToVerification) {
		const email = user && "email" in user ? user.email : "";
		const search = email ? `?email=${encodeURIComponent(email)}` : "";
		return <Navigate to={`/verify-email${search}`} replace />;
	}

	// use dedicated mobile layout for mobile devices
	if (isMobile) {
		return <MobileLayout />;
	}

	return (
		<DesktopAppShell
			isMessagesPage={isMessagesPage}
			isAdminPage={isAdminPage}
			isSettingsPage={isSettingsPage}
			isUploadModalOpen={isUploadModalOpen}
			onCloseUploadModal={handleCloseUploadModal}
			onOpenUploadModal={handleOpenUploadModal}
		/>
	);
};

export default Layout;
