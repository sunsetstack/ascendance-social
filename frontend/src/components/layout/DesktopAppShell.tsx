import { lazy, Suspense } from "react";
import { Box } from "@mui/material";
import { Outlet } from "react-router-dom";
import LeftSidebar from "../LeftSidebar";
import AppBrand from "./AppBrand";

const RightSidebar = lazy(() => import("../RightSidebar"));
const UploadForm = lazy(() => import("../UploadForm"));

interface DesktopAppShellProps {
	isMessagesPage: boolean;
	isAdminPage: boolean;
	isSettingsPage: boolean;
	isUploadModalOpen: boolean;
	onCloseUploadModal: () => void;
	onOpenUploadModal: () => void;
}

export const DesktopAppShell: React.FC<DesktopAppShellProps> = ({
	isMessagesPage, isAdminPage, isSettingsPage, isUploadModalOpen, onCloseUploadModal, onOpenUploadModal,
}) => {
	const showSidebar = !isMessagesPage && !isAdminPage && !isSettingsPage;
	return (
		<Box sx={{ width: { md: "calc(100% - 32px)", lg: "calc(100% - 48px)" }, maxWidth: showSidebar ? 1312 : 1560, mx: "auto", minHeight: "100dvh",
			height: isMessagesPage ? "100dvh" : "auto", display: "flex", flexDirection: "column",
			overflow: "clip", bgcolor: "background.default" }}>
			<Box sx={{ display: "flex", flex: 1, minHeight: 0, justifyContent: "center" }}>
				<Box sx={{ width: { md: 80, lg: 256, xl: 280 }, flexShrink: 0 }}>
					<Box sx={{ position: "sticky", top: 0, height: "100dvh", minHeight: 440, display: "flex", flexDirection: "column" }}>
						<Box sx={{ minHeight: 80, px: { md: 1, lg: 2 }, display: "flex", alignItems: "center", justifyContent: { md: "center", lg: "flex-start" }, flexShrink: 0 }}><AppBrand rail /></Box>
						<Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}><LeftSidebar onPostClick={onOpenUploadModal} /></Box>
					</Box>
				</Box>
				<Box component="main" sx={{ flex: 1, maxWidth: showSidebar ? 640 : undefined, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column",
					borderLeft: 1, borderRight: showSidebar ? 1 : 0, borderColor: "divider", overflow: isMessagesPage ? "hidden" : "visible" }}>
					<Outlet />
				</Box>
				{showSidebar && (
					<Box sx={{ width: { md: 280, lg: 340, xl: 360 }, ml: { md: 3, lg: 4 }, flexShrink: 0, pt: 1.5 }}>
						<Box sx={{ position: "sticky", top: 12, maxHeight: "calc(100dvh - 24px)", overflowY: "auto" }}>
							<Suspense fallback={null}><RightSidebar onPostClick={onOpenUploadModal} /></Suspense>
						</Box>
					</Box>
				)}
			</Box>
			{isUploadModalOpen && <Suspense fallback={null}><UploadForm onClose={onCloseUploadModal} /></Suspense>}
		</Box>
	);
};
