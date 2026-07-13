import React from "react";
import { Fab } from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";

interface MobileFABProps {
	onClick: () => void;
}

const MobileFAB: React.FC<MobileFABProps> = ({ onClick }) => {
	return (
		<Fab
			color="primary"
			aria-label="Create new post"
			onClick={onClick}
			sx={{
				position: "fixed",
				// positioned with safe area consideration
				bottom: "calc(72px + env(safe-area-inset-bottom))",
				right: 16,
				zIndex: 1100,
				width: 56,
				height: 56,
				boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
			}}
		>
			<AddIcon />
		</Fab>
	);
};

export default MobileFAB;
