import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
	shape: { borderRadius: 4 },
	palette: {
		mode: "dark",
		primary: { main: "#38bdf8", light: "#7dd3fc", dark: "#0ea5e9", contrastText: "#05131d" },
		secondary: { main: "#8b5cf6" },
		background: { default: "#080b10", paper: "#11161e" },
		text: { primary: "#e9eef5", secondary: "#9aa8ba" },
		divider: "#242d38",
		action: { hover: "rgba(154, 168, 186, 0.06)", selected: "rgba(56, 189, 248, 0.10)" },
	},
	typography: {
		fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		body1: { fontSize: "1.125rem", lineHeight: 1.5 },
		body2: { fontSize: "1rem", lineHeight: 1.5 },
		caption: { fontSize: "0.875rem", lineHeight: 1.5 },
		subtitle1: { fontSize: "1.125rem" },
		subtitle2: { fontSize: "1rem" },
		h1: { fontWeight: 700 },
		h2: { fontWeight: 700 },
		h3: { fontWeight: 700 },
		h4: { fontWeight: 700, letterSpacing: "-0.5px" },
		h5: { fontWeight: 700, fontSize: "1.25rem" },
		h6: { fontWeight: 600, fontSize: "1.125rem" },
		button: { textTransform: "none", fontWeight: 600, fontSize: "1rem" },
	},
	components: {
		MuiCssBaseline: {
			styleOverrides: { body: { backgroundColor: "#080b10", scrollbarWidth: "thin" } },
		},
		MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
		MuiDrawer: {
			styleOverrides: { paper: { backgroundColor: "#0c1016", borderRight: "1px solid #242d38", backgroundImage: "none" } },
		},
		MuiAppBar: {
			styleOverrides: {
				root: {
					backgroundColor: "rgba(8, 11, 16, 0.92)", backdropFilter: "blur(12px)",
					borderBottom: "1px solid #242d38", boxShadow: "none", color: "#e9eef5", backgroundImage: "none",
				},
			},
		},
		MuiCard: {
			styleOverrides: {
				root: {
					backgroundColor: "transparent", border: "none", borderRadius: 0,
					backgroundImage: "none", boxShadow: "none",
					"&:hover": { backgroundColor: "rgba(154, 168, 186, 0.03)" },
				},
			},
		},
		MuiDialog: {
			styleOverrides: { paper: { backgroundColor: "#11161e", border: "1px solid #242d38", borderRadius: 12, backgroundImage: "none" } },
		},
		MuiMenu: {
			styleOverrides: {
				paper: {
					backgroundColor: "#11161e", border: "1px solid #242d38", borderRadius: 8,
					boxShadow: "0 12px 32px rgba(0, 0, 0, 0.3)", backgroundImage: "none",
				},
			},
		},
		MuiButton: {
			styleOverrides: {
				root: { borderRadius: 8, textTransform: "none", fontWeight: 600, boxShadow: "none" },
				containedPrimary: { color: "#05131d", "&:hover": { backgroundColor: "#7dd3fc", boxShadow: "none" } },
				outlined: {
					borderColor: "#3c4b5d", color: "#e9eef5",
					"&:hover": { backgroundColor: "rgba(154, 168, 186, 0.06)", borderColor: "#9aa8ba" },
				},
			},
		},
		MuiIconButton: {
			styleOverrides: { root: { color: "#9aa8ba", "&:hover": { backgroundColor: "rgba(56, 189, 248, 0.12)", color: "#38bdf8" } } },
		},
		MuiOutlinedInput: {
			styleOverrides: {
				root: {
					borderRadius: 8, color: "#e9eef5",
					"& .MuiOutlinedInput-notchedOutline": { borderColor: "#344254" },
					"&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#9aa8ba" },
					"&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#38bdf8" },
				},
			},
		},
		MuiInputLabel: { styleOverrides: { root: { color: "#9aa8ba", "&.Mui-focused": { color: "#38bdf8" } } } },
		MuiChip: {
			styleOverrides: {
				root: {
					fontSize: "0.9375rem", borderRadius: 9999, backgroundColor: "transparent", border: "1px solid #344254", color: "#b5c1d0",
					"&:hover": { backgroundColor: "rgba(154, 168, 186, 0.1)" },
				},
				sizeSmall: { fontSize: "0.875rem" },
				filled: {
					backgroundColor: "#172431",
					"&.MuiChip-colorPrimary": { backgroundColor: "#38bdf8", borderColor: "#38bdf8", color: "#05131d" },
				},
			},
		},
		MuiTab: { styleOverrides: { root: { textTransform: "none", fontWeight: 600, minHeight: 44 } } },
		MuiToggleButton: {
			styleOverrides: { root: { textTransform: "none", color: "#9aa8ba", "&.Mui-selected": { backgroundColor: "#193244", color: "#c1e9ff" } } },
		},
	},
});
