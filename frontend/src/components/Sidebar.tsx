import React from "react";
import { Box, Button, Stack } from "@mui/material";

interface SidebarProps {
	setView: (view: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ setView }) => {
	return (
		<Box component="nav" sx={{ display: "flex", justifyContent: "center" }}>
			<Stack direction="row" spacing={1} sx={{ px: 1 }}>
				<Button
					variant="text"
					color="inherit"
					onClick={() => setView("gallery")}
					sx={{ fontSize: "1.125rem" }}
				>
					Gallery
				</Button>
				<Button
					variant="text"
					color="inherit"
					onClick={() => setView("editProfile")}
					sx={{ fontSize: "1.125rem" }}
				>
					Update Profile
				</Button>
			</Stack>
		</Box>
	);
};

export default Sidebar;
