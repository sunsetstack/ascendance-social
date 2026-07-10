import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
	palette: {
		mode: "dark", // switches MUI internal logic to dark mode
		primary: {
			main: "#38bdf8",
			light: "#7dd3fc",
			dark: "#0ea5e9",
			contrastText: "#ffffff",
		},
		secondary: {
			main: "#8b5cf6",
		},
		background: {
			default: "#07090d",
			paper: "#0e131a",
		},
		text: {
			primary: "#f1f5f9",
			secondary: "#8b98a7",
		},
		divider: "rgba(148, 163, 184, 0.18)",
	},
	typography: {
		fontFamily: '"Open Sans", "Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"',
		allVariants: {
			color: "#e7e9ea",
		},
		h1: {
			fontFamily: '"Montserrat", "sans-serif"',
			fontWeight: 800,
		},
		h2: {
			fontFamily: '"Montserrat", "sans-serif"',
			fontWeight: 800,
		},
		h3: {
			fontFamily: '"Montserrat", "sans-serif"',
			fontWeight: 700,
		},
		h4: {
			fontFamily: '"Montserrat", "sans-serif"',
			fontWeight: 700,
			letterSpacing: "-0.5px",
		},
		h5: {
			fontFamily: '"Montserrat", "sans-serif"',
			fontWeight: 700,
		},
		h6: {
			fontFamily: '"Montserrat", "sans-serif"',
			fontWeight: 600,
		},
		button: {
			fontFamily: '"Montserrat", "sans-serif"',
			textTransform: "none",
			fontWeight: 700,
		},
	},
	components: {
		MuiCssBaseline: {
			styleOverrides: {
				body: {
					backgroundColor: "#07090d",
					scrollbarWidth: "thin",
				},
			},
		},

		MuiDrawer: {
			styleOverrides: {
				paper: {
					backgroundColor: "#000000",
					borderRight: "1px solid #2f3336",
					backgroundImage: "none",
				},
			},
		},

		MuiAppBar: {
			styleOverrides: {
				root: {
					backgroundColor: "rgba(0, 0, 0, 0.65)", // Semi-transparent
					backdropFilter: "blur(12px)",
					borderBottom: "1px solid #2f3336",
					boxShadow: "none",
					color: "#e7e9ea",
					backgroundImage: "none",
				},
			},
		},

		MuiCard: {
			styleOverrides: {
				root: {
					backgroundColor: "transparent",
					borderBottom: "1px solid #2f3336",
					border: "none",
					borderRadius: 0,
					backgroundImage: "none",
					boxShadow: "none",
					"&:hover": {
						backgroundColor: "rgba(255, 255, 255, 0.03)",
					},
				},
			},
		},

		MuiDialog: {
			styleOverrides: {
				paper: {
					backgroundColor: "#000000",
					border: "1px solid #2f3336",
					borderRadius: 16,
					backgroundImage: "none",
				},
			},
		},

		MuiMenu: {
			styleOverrides: {
				paper: {
					backgroundColor: "#000000",
					border: "1px solid #2f3336",
					borderRadius: 12,
					backgroundImage: "none",
					boxShadow: "0px 8px 24px rgba(255, 255, 255, 0.1)",
				},
			},
		},

		MuiButton: {
			styleOverrides: {
				root: {
					borderRadius: 9999,
					textTransform: "none",
					fontWeight: 700,
					boxShadow: "none",
				},
				containedPrimary: {
					borderColor: "#536471",
					color: "#e7e9ea",

					"&:hover": {
						backgroundColor: "#0ea5e9",
						boxShadow: "none",
					},
				},
				outlined: {
					borderColor: "#536471",
					color: "#e7e9ea",
					"&:hover": {
						backgroundColor: "rgba(231, 233, 234, 0.1)",
						borderColor: "#536471",
					},
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					color: "#8b98a7",
					"&:hover": {
						backgroundColor: "rgba(56, 189, 248, 0.12)",
						color: "#38bdf8",
					},
				},
			},
		},

		MuiOutlinedInput: {
			styleOverrides: {
				root: {
					borderRadius: 4,
					"& .MuiOutlinedInput-notchedOutline": {
						borderColor: "#2f3336",
					},
					"&:hover .MuiOutlinedInput-notchedOutline": {
						borderColor: "#71767b",
					},
					"&.Mui-focused .MuiOutlinedInput-notchedOutline": {
						borderColor: "#0ea5e9",
					},
					color: "#e7e9ea",
				},
			},
		},

		MuiInputLabel: {
			styleOverrides: {
				root: {
					color: "#71767b",
					"&.Mui-focused": {
						color: "#71767b",
					},
				},
			},
		},

		MuiChip: {
			styleOverrides: {
				root: {
					borderRadius: 9999,
					backgroundColor: "transparent",
					border: "1px solid #2f3336",
					color: "#71767b",
					"&:hover": {
						backgroundColor: "rgba(231, 233, 234, 0.1)",
					},
				},
				filled: {
					backgroundColor: "#2f3336",
					border: "none",
					color: "#e7e9ea",
				},
			},
		},
	},
});
