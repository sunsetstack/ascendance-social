import { Box, useTheme } from "@mui/material";
import { Outlet } from "react-router-dom";
import LeftSidebar from "../LeftSidebar";
import RightSidebar from "../RightSidebar";
import UploadForm from "../UploadForm";

interface DesktopAppShellProps {
	isMessagesPage: boolean;
	isAdminPage: boolean;
	isSettingsPage: boolean;
	isUploadModalOpen: boolean;
	onCloseUploadModal: () => void;
	onOpenUploadModal: () => void;
}

export const DesktopAppShell: React.FC<DesktopAppShellProps> = ({
	isMessagesPage,
	isAdminPage,
	isSettingsPage,
	isUploadModalOpen,
	onCloseUploadModal,
	onOpenUploadModal,
}) => {
	const theme = useTheme();

	return (
		<Box
			sx={{
				height: isMessagesPage ? "100vh" : "auto",
				minHeight: "100vh",
				display: "flex",
				bgcolor: "background.default",
				justifyContent: "center",
				overflow: isMessagesPage ? "hidden" : "visible",
			}}
		>
			<Box
				sx={{
					display: "flex",
					width: "100%",
					maxWidth: "1280px",
					height: isMessagesPage ? "100%" : "auto",
				}}
			>
				<Box
					component="header"
					sx={{
						width: { md: 88, lg: 275 },
						flexShrink: 0,
						display: "flex",
						flexDirection: "column",
						alignItems: { md: "center", lg: "flex-start" },
					}}
				>
					<Box
						sx={{
							position: "fixed",
							height: "100vh",
							width: { md: 88, lg: 275 },
							zIndex: 10,
							borderRight: `1px solid ${theme.palette.divider}`,
						}}
					>
						<LeftSidebar onPostClick={onOpenUploadModal} />
					</Box>
				</Box>

				<Box
					component="main"
					sx={{
						flexGrow: 1,
						flexShrink: 1,
						display: "flex",
						flexDirection: "column",
						minWidth: 0,
						minHeight: 0,
						borderRight:
							!isMessagesPage && !isAdminPage && !isSettingsPage
								? `1px solid ${theme.palette.divider}`
								: "none",
						maxWidth: isMessagesPage || isAdminPage ? "100%" : isSettingsPage ? 900 : 600,
						width: "100%",
						height: isMessagesPage ? "100%" : "auto",
						overflow: isMessagesPage ? "hidden" : "visible",
					}}
				>
					<Outlet />
				</Box>

				{!isMessagesPage && !isAdminPage && !isSettingsPage && (
					<Box
						sx={{
							marginLeft: 3,
							width: 350,
							flexShrink: 0,
							display: { xs: "none", md: "none", lg: "block" },
						}}
					>
						<Box
							sx={{
								position: "fixed",
								height: "100vh",
								width: 350,
								zIndex: 10,
								overflowY: "auto",
							}}
						>
							<RightSidebar />
						</Box>
					</Box>
				)}
			</Box>

			{isUploadModalOpen && <UploadForm onClose={onCloseUploadModal} />}
		</Box>
	);
};
