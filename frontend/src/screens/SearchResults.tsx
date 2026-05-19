import { useState, useEffect, useMemo } from "react";
import { useSearch } from "../hooks/search/useSearch";
import { usePostsByTag } from "../hooks/posts/usePosts";
import { Avatar, Box, Button, CircularProgress, Typography } from "@mui/material";
import Gallery from "../components/Gallery";
import { Link, useLocation } from "react-router-dom";
import { PageSeo } from "../lib/PageSeo";
import { buildSearchMetadata } from "../lib/seo";

const SearchResults = () => {
	const location = useLocation();

	// Parse the search query
	const searchParams = new URLSearchParams(location.search);
	const queryParam = searchParams.get("q") || "";
	const tagsParam = searchParams.get("tags") || "";
	const displayQuery = tagsParam || queryParam;

	const searchMode = useMemo(() => {
		if (tagsParam.trim()) {
			return "tags" as const;
		}
		const trimmed = queryParam.trim();
		if (trimmed.startsWith("#")) {
			return "tags" as const;
		}
		if (trimmed.startsWith("@")) {
			return "handles" as const;
		}
		return "default" as const;
	}, [queryParam, tagsParam]);

	const normalizedQuery = useMemo(() => {
		if (searchMode === "tags") {
			const rawTags = tagsParam || queryParam;
			return rawTags.replace(/^#+/, "");
		}
		if (searchMode === "handles") {
			return queryParam.replace(/^@+/, "");
		}
		return queryParam;
	}, [queryParam, tagsParam, searchMode]);

	// prevent unnecessary re-renders
	const searchTerms = useMemo(() => {
		const baseQuery = tagsParam || normalizedQuery;
		return baseQuery
			.split(",")
			.map((t) => t.replace(/^#+/, "").trim())
			.filter((t) => t.length > 0);
	}, [normalizedQuery, tagsParam]);

	const [activeTab, setActiveTab] = useState<"posts" | "users" | "communities">("posts");

	useEffect(() => {
		setActiveTab("posts");
	}, [displayQuery]);

	const { data: searchData, isFetching: isSearchingUsers } = useSearch(normalizedQuery);

	// Fetch Posts with infinite scroll
	const {
		data: postsData,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading: isLoadingPosts,
	} = usePostsByTag(searchTerms, {
		enabled: searchMode === "tags" && searchTerms.length > 0,
	});

	// Flatten pages
	const allPosts = useMemo(() => {
		if (searchMode === "tags") {
			return postsData?.pages.flatMap((page) => page.data) || [];
		}
		return searchData?.data.posts || [];
	}, [postsData, searchData, searchMode]);

	useEffect(() => {
		const isModeLoading = (searchMode === "tags" && isLoadingPosts) || isSearchingUsers;

		if (!isModeLoading && activeTab === "posts") {
			const hasPosts = allPosts.length > 0;
			const hasUsers = searchData?.data.users && searchData.data.users.length > 0;

			if (!hasPosts && hasUsers) {
				setActiveTab("users");
			}
		}
	}, [isLoadingPosts, isSearchingUsers, allPosts.length, searchData, activeTab, searchMode]);

	const users = searchData?.data.users ?? [];
	const communities = searchData?.data.communities ?? [];
	const isLoading = (searchMode === "tags" && isLoadingPosts) || isSearchingUsers;

	const getFullAvatarUrl = (avatar?: string) => {
		if (!avatar) return undefined;
		if (avatar.startsWith("http")) return avatar;
		if (avatar.startsWith("/")) return `/api${avatar}`;
		return `/api/${avatar}`;
	};

	return (
		<>
			<PageSeo {...buildSearchMetadata(displayQuery, location.search)} />
			<Box sx={{ maxWidth: "800px", mx: "auto", p: 3 }}>
				{/* Tab Buttons */}
				<Box sx={{ display: "flex", gap: 2, mb: 3 }}>
					<Button variant={activeTab === "posts" ? "contained" : "outlined"} onClick={() => setActiveTab("posts")}>
						Posts ({allPosts.length})
					</Button>
					<Button variant={activeTab === "users" ? "contained" : "outlined"} onClick={() => setActiveTab("users")}>
						Users ({users.length})
					</Button>
					<Button
						variant={activeTab === "communities" ? "contained" : "outlined"}
						onClick={() => setActiveTab("communities")}
					>
						Communities ({communities.length})
					</Button>
				</Box>

				{isLoading && allPosts.length === 0 ? (
					<Box sx={{ display: "flex", justifyContent: "center", mt: 5 }}>
						<CircularProgress />
					</Box>
				) : (
					<>
						{/* Posts tab */}
						{activeTab === "posts" && (
							<Box>
								{allPosts.length > 0 ? (
									<Gallery
										posts={allPosts}
										fetchNextPage={fetchNextPage}
										isFetchingNext={isFetchingNextPage}
										hasNextPage={!!hasNextPage}
									/>
								) : (
									<Typography color="text.secondary" sx={{ mt: 4, textAlign: "center" }}>
										No posts found for "{displayQuery}".
									</Typography>
								)}
							</Box>
						)}

						{/* Users tab */}
						{activeTab === "users" && (
							<Box>
								{users.length > 0 ? (
									users.map((user) => (
										<Box
											key={user.publicId}
											sx={{
												p: 2,
												borderBottom: "1px solid #eee",
												display: "flex",
												alignItems: "center",
												gap: 2,
												"&:hover": { bgcolor: "rgba(0,0,0,0.02)" },
											}}
										>
											<Avatar src={getFullAvatarUrl(user.avatar)} alt={user.username} sx={{ width: 40, height: 40 }}>
												{user.username}
											</Avatar>
											<Link
												to={`/profile/${user.handle}`}
												style={{ textDecoration: "none", fontWeight: "bold", color: "inherit" }}
											>
												@{user.handle}
											</Link>
										</Box>
									))
								) : (
									<Typography color="text.secondary" sx={{ mt: 4, textAlign: "center" }}>
										No users found matching "{displayQuery}".
									</Typography>
								)}
							</Box>
						)}

						{/* Communities tab */}
						{activeTab === "communities" && (
							<Box>
								{communities.length > 0 ? (
									communities.map((community) => (
										<Box
											key={community.publicId}
											sx={{
												p: 2,
												borderBottom: "1px solid #eee",
												display: "flex",
												alignItems: "center",
												gap: 2,
												"&:hover": { bgcolor: "rgba(0,0,0,0.02)" },
											}}
										>
											<Avatar src={community.avatar} variant="rounded" sx={{ width: 40, height: 40 }}>
												{community.name.charAt(0)}
											</Avatar>
											<Box>
												<Link
													to={`/communities/${community.slug}`}
													style={{ textDecoration: "none", fontWeight: "bold", color: "inherit", display: "block" }}
												>
													{community.name}
												</Link>
												<Typography variant="body2" color="text.secondary">
													{community.description}
												</Typography>
											</Box>
										</Box>
									))
								) : (
									<Typography color="text.secondary" sx={{ mt: 4, textAlign: "center" }}>
										No communities found matching "{displayQuery}".
									</Typography>
								)}
							</Box>
						)}
					</>
				)}
			</Box>
		</>
	);
};

export default SearchResults;
