import React from "react";
import { Box, Button, Typography } from "@mui/material";

interface AppErrorBoundaryProps {
	children: React.ReactNode;
}

interface AppErrorBoundaryState {
	hasError: boolean;
}

export class AppErrorBoundary extends React.Component<
	AppErrorBoundaryProps,
	AppErrorBoundaryState
> {
	override state: AppErrorBoundaryState = {
		hasError: false,
	};

	static getDerivedStateFromError(): AppErrorBoundaryState {
		return { hasError: true };
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		if (import.meta.env.DEV) {
			console.error("AppErrorBoundary caught an error", error, errorInfo);
		}
	}

	private readonly handleReload = () => {
		window.location.reload();
	};

	override render() {
		if (this.state.hasError) {
			return (
				<Box
					sx={{
						minHeight: "100vh",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						bgcolor: "background.default",
						px: 3,
					}}
				>
					<Box sx={{ maxWidth: 420, textAlign: "center" }}>
						<Typography variant="h5" fontWeight={800} gutterBottom>
							Something went wrong
						</Typography>
						<Typography variant="body2" color="text.secondary">
							The app hit an unexpected UI error. Reloading usually gets things
							back into a healthy state.
						</Typography>
						<Button variant="contained" sx={{ mt: 3, borderRadius: 9999 }} onClick={this.handleReload}>
							Reload app
						</Button>
					</Box>
				</Box>
			);
		}

		return this.props.children;
	}
}
