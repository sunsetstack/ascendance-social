import {
	Box,
	Typography,
	IconButton,
	List,
	ListItem,
	Divider,
	CircularProgress,
} from "@mui/material";
import { ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import { useAccountInfo } from "../../hooks/settings";

interface AccountInfoProps {
	onBack: () => void;
}

const formatDate = (dateString: string) => {
	const date = new Date(dateString);
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
};

const AccountInfo = ({ onBack }: AccountInfoProps) => {
	const { data: accountInfo, isLoading, error } = useAccountInfo();

	if (isLoading) {
		return (
			<Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200 }}>
				<CircularProgress />
			</Box>
		);
	}

	if (error || !accountInfo) {
		return (
			<Box sx={{ p: 2 }}>
				<Typography color="error">Failed to load account information</Typography>
			</Box>
		);
	}

	const infoItems = [
		{ label: "Username", value: accountInfo.username },
		{ label: "User Handle", value: `@${accountInfo.handle}`, secondary: "Cannot be changed" },
		{ label: "Email", value: accountInfo.email },
		{
			label: "Email Verified",
			value: accountInfo.isEmailVerified ? "Yes" : "No",
			highlight: !accountInfo.isEmailVerified,
		},
		{ label: "Account Creation", value: formatDate(accountInfo.createdAt) },
		...(accountInfo.registrationIp
			? [{ label: "Registration IP", value: accountInfo.registrationIp }]
			: []),
	];

	return (
		<Box>
			{/* header */}
			<Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
				<IconButton onClick={onBack} size="small">
					<ArrowBackIcon />
				</IconButton>
				<Typography variant="h6" fontWeight={700}>
					Account Information
				</Typography>
			</Box>

			<List disablePadding>
				{infoItems.map((item, index) => (
					<Box key={item.label}>
						<ListItem
							sx={{
								py: 2,
								px: 0,
								flexDirection: "column",
								alignItems: "flex-start",
							}}
						>
							<Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
								{item.label}
							</Typography>
							<Typography
								variant="body1"
								fontWeight={500}
								color={item.highlight ? "warning.main" : "text.primary"}
							>
								{item.value}
							</Typography>
							{item.secondary && (
								<Typography variant="caption" color="text.secondary">
									{item.secondary}
								</Typography>
							)}
						</ListItem>
						{index < infoItems.length - 1 && <Divider />}
					</Box>
				))}
			</List>
		</Box>
	);
};

export default AccountInfo;
