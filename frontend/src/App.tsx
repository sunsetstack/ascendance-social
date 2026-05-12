import { Route, Routes, BrowserRouter } from "react-router-dom";
import { lazy, Suspense } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { Box, CircularProgress, CssBaseline } from "@mui/material";
import Home from "./screens/Home";
import Layout from "./components/Layout";
import FeedSocketManager from "./components/FeedSocketManager";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { theme } from "./theme/theme";
import { SocketProvider } from "./context/Socket/SocketProvider";
import AuthProvider from "./context/Auth/AuthProvider";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";

// initialize telemetry on app load
import "./lib/telemetry";

const Discovery = lazy(() => import("./screens/Discovery"));
const Communities = lazy(() => import("./screens/Communities"));
const CommunityDetails = lazy(() => import("./screens/CommunityDetails"));
const CommunityMembers = lazy(() => import("./screens/CommunityMembers"));
const Login = lazy(() => import("./screens/Login"));
const ForgotPassword = lazy(() => import("./screens/ForgotPassword"));
const ResetPassword = lazy(() => import("./screens/ResetPassword"));
const VerifyEmail = lazy(() => import("./screens/VerifyEmail"));
const Register = lazy(() => import("./screens/Register"));
const Profile = lazy(() => import("./screens/Profile"));
const FollowList = lazy(() => import("./screens/FollowList"));
const SearchResults = lazy(() => import("./screens/SearchResults"));
const PostView = lazy(() => import("./screens/PostView"));
const Favorites = lazy(() => import("./screens/Favorites"));
const Messages = lazy(() => import("./screens/Messages"));
const Notifications = lazy(() => import("./screens/Notifications"));
const Settings = lazy(() => import("./screens/Settings"));
const AdminUserDetail = lazy(() => import("./screens/AdminUserDetail"));
const AdminDashboard = lazy(() => import("./screens/Admin").then((module) => ({ default: module.AdminDashboard })));
const CommentThreadView = lazy(() =>
	import("./components/comments").then((module) => ({ default: module.CommentThreadView })),
);

const queryClient = new QueryClient();

function App() {

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<BrowserRouter>
				<QueryClientProvider client={queryClient}>
					<AuthProvider>
						<SocketProvider>
							<FeedSocketManager />
							<Suspense
								fallback={
									<Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
										<CircularProgress size={24} />
									</Box>
								}
							>
								<Routes>
									<Route path="/" element={<Layout />}>
										<Route index element={<Home />} />
										<Route path="discover" element={<Discovery />} />
										<Route path="communities" element={<Communities />} />
										<Route path="communities/:slug" element={<CommunityDetails />} />
										<Route path="communities/:slug/members" element={<CommunityMembers />} />
										<Route path="login" element={<Login />} />
										<Route path="forgot-password" element={<ForgotPassword />} />
										<Route path="reset-password" element={<ResetPassword />} />
										<Route path="verify-email" element={<VerifyEmail />} />
										<Route path="register" element={<Register />} />
										<Route path="profile/:id" element={<Profile />} />
										<Route path="profile/:id/follow" element={<FollowList />} />
										<Route path="/results" element={<SearchResults />} />
										<Route path="posts/:id" element={<PostView />} />
										<Route path="comments/:commentId" element={<CommentThreadView />} />
										<Route path="favorites" element={<ProtectedRoute element={<Favorites />} />} />
										<Route path="messages" element={<ProtectedRoute element={<Messages />} />} />
										<Route path="notifications" element={<ProtectedRoute element={<Notifications />} />} />
										<Route path="settings" element={<ProtectedRoute element={<Settings />} />} />
										<Route path="admin" element={<AdminRoute element={<AdminDashboard />} />} />
										<Route path="admin/users/:id" element={<AdminRoute element={<AdminUserDetail />} />} />
									</Route>
								</Routes>
							</Suspense>
						</SocketProvider>
					</AuthProvider>
				</QueryClientProvider>
			</BrowserRouter>
		</ThemeProvider>
	);
}

export default App;
