import { Box, SxProps, Theme } from "@mui/material";
import VerifyEmail from "../../screens/VerifyEmail";

interface EmailVerificationGateProps {
	sx?: SxProps<Theme>;
}

export const EmailVerificationGate: React.FC<EmailVerificationGateProps> = ({ sx }) => {
	return (
		<Box
			sx={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				bgcolor: "background.default",
				...sx,
			}}
		>
			<VerifyEmail />
		</Box>
	);
};
