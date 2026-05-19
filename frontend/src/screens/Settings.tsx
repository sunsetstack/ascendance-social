import { useState } from "react";
import {
	Box,
	Typography,
	List,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	useMediaQuery,
	useTheme,
	alpha,
} from "@mui/material";
import {
	Person as PersonIcon,
	Lock as LockIcon,
	PersonOff as PersonOffIcon,
	ChevronRight as ChevronRightIcon,
} from "@mui/icons-material";
import AccountInfo from "../components/settings/AccountInfo";
import ChangePassword from "../components/settings/ChangePassword";
import DeactivateAccount from "../components/settings/DeactivateAccount";

type SettingsSection = "main" | "account-info" | "change-password" | "deactivate";

const Settings = () => {
	const theme = useTheme();
	const isMobile = useMediaQuery(theme.breakpoints.down("md"));
	const [activeSection, setActiveSection] = useState<SettingsSection>("main");

	const menuItems = [
		{
			id: "account-info" as const,
			icon: <PersonIcon />,
			title: "Account Information",
			description: "See your account information like email and registration details",
		},
		{
			id: "change-password" as const,
			icon: <LockIcon />,
			title: "Change Password",
			description: "Change your password at any time",
		},
		{
			id: "deactivate" as const,
			icon: <PersonOffIcon />,
			title: "Deactivate Account",
			description: "Find out how you can deactivate your account",
			danger: true,
		},
	];

	const handleBack = () => setActiveSection("main");

	const renderContent = () => {
		switch (activeSection) {
			case "account-info":
				return <AccountInfo onBack={handleBack} />;
			case "change-password":
				return <ChangePassword onBack={handleBack} />;
			case "deactivate":
				return <DeactivateAccount onBack={handleBack} />;
			default:
				return null;
		}
	};

	// mobile: show either menu or content
	if (isMobile) {
		if (activeSection !== "main") {
			return renderContent();
		}

		return (
			<Box sx={{ p: 2 }}>
				<Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>
					Your Account
				</Typography>
				<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
					See information about your account, change your password, or learn about your account deactivation options.
				</Typography>

				<List disablePadding>
					{menuItems.map((item) => (
						<ListItemButton
							key={item.id}
							onClick={() => setActiveSection(item.id)}
							sx={{
								py: 2,
								borderRadius: 2,
								mb: 1,
								"&:hover": {
									bgcolor: alpha(theme.palette.text.primary, 0.05),
								},
							}}
						>
							<ListItemIcon sx={{ color: item.danger ? "error.main" : "text.secondary" }}>
								{item.icon}
							</ListItemIcon>
							<ListItemText
								primary={
									<Typography fontWeight={600} color={item.danger ? "error.main" : "text.primary"}>
										{item.title}
									</Typography>
								}
								secondary={item.description}
							/>
							<ChevronRightIcon sx={{ color: "text.secondary" }} />
						</ListItemButton>
					))}
				</List>
			</Box>
		);
	}

	// desktop: two-column layout
	return (
		<Box sx={{ display: "flex", height: "100%" }}>
			{/* left menu */}
			<Box
				sx={{
					width: 360,
					flexShrink: 0,
					borderRight: `1px solid ${theme.palette.divider}`,
					p: 3,
				}}
			>
				<Typography variant="h5" fontWeight={800} sx={{ mb: 1 }}>
					Your Account
				</Typography>
				<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
					See information about your account, change your password, or learn about your account deactivation options.
				</Typography>

				<List disablePadding>
					{menuItems.map((item) => (
						<ListItemButton
							key={item.id}
							selected={activeSection === item.id}
							onClick={() => setActiveSection(item.id)}
							sx={{
								py: 2,
								borderRadius: 2,
								mb: 1,
								"&.Mui-selected": {
									bgcolor: alpha(theme.palette.primary.main, 0.1),
									borderRight: `3px solid ${theme.palette.primary.main}`,
								},
								"&:hover": {
									bgcolor: alpha(theme.palette.text.primary, 0.05),
								},
							}}
						>
							<ListItemIcon sx={{ color: item.danger ? "error.main" : "text.secondary" }}>
								{item.icon}
							</ListItemIcon>
							<ListItemText
								primary={
									<Typography fontWeight={600} color={item.danger ? "error.main" : "text.primary"}>
										{item.title}
									</Typography>
								}
								secondary={item.description}
							/>
							<ChevronRightIcon sx={{ color: "text.secondary" }} />
						</ListItemButton>
					))}
				</List>
			</Box>

			{/* right content */}
			<Box sx={{ flex: 1, p: 3 }}>
				{activeSection === "main" ? (
					<Box
						sx={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							height: "100%",
							color: "text.secondary",
						}}
					>
						<Typography>Select an option from the menu</Typography>
					</Box>
				) : (
					renderContent()
				)}
			</Box>
		</Box>
	);
};

export default Settings;
