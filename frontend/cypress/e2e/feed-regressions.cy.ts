const basePost = {
	tags: [],
	likes: 0,
	commentsCount: 0,
	viewsCount: 0,
	isLikedByViewer: false,
	isFavoritedByViewer: false,
	isRepostedByViewer: false,
};

const makeTextPost = (publicId: string, body: string) => ({
	...basePost,
	publicId,
	body,
	type: "original",
	createdAt: "2026-08-10T12:00:00.000Z",
	user: {
		publicId: "feed-user",
		handle: "feed-user",
		username: "Feed User",
		avatar: "",
	},
	image: null,
	community: null,
});

const feedPage = (posts: unknown[]) => ({
	data: posts,
	page: 1,
	limit: 5,
	total: posts.length,
	totalPages: 1,
	hasMore: false,
});

const stubAnonymousAuth = () => {
	cy.intercept("GET", "/api/users/me", {
		statusCode: 401,
		body: { message: "Authentication required" },
	}).as("currentUser");
	cy.intercept("POST", "/api/users/refresh", {
		statusCode: 401,
		body: { message: "Authentication required" },
	});
};

const stubAuthenticatedAuth = () => {
	cy.intercept("GET", "/api/users/me", {
		statusCode: 200,
		body: {
			publicId: "feed-viewer",
			handle: "feed-viewer",
			username: "Feed Viewer",
			email: "feed-viewer@example.com",
			avatar: "",
			cover: "",
			bio: "",
			createdAt: "2026-01-01T12:00:00.000Z",
			postCount: 0,
			followerCount: 0,
			followingCount: 0,
			isEmailVerified: true,
		},
	}).as("currentUser");
};

const emptyCommentsPage = {
	comments: [],
	page: 1,
	limit: 10,
	total: 0,
	totalPages: 0,
};

describe("Feed rendering regressions", () => {
	beforeEach(() => {
		cy.clearCookies();
		cy.clearLocalStorage();
	});

	it("renders repost content in the Latest feed on first load", () => {
		cy.intercept("GET", "**/api/feed/new*", {
			statusCode: 200,
			body: {
				data: [
					{
						...basePost,
						publicId: "repost-entry",
						body: "",
						type: "repost",
						repostCount: 0,
						createdAt: "2026-03-01T12:00:00.000Z",
						user: {
							publicId: "sharing-user",
							handle: "sharer",
							username: "Sharer",
							avatar: "",
						},
						repostOf: {
							publicId: "original-post",
							body: "Original body",
							user: {
								publicId: "original-user",
								handle: "original",
								username: "Original Author",
								avatar: "",
							},
							image: null,
							likes: 0,
							repostCount: 0,
							commentsCount: 0,
						},
						image: null,
						community: null,
					},
				],
				page: 1,
				limit: 10,
				total: 1,
				totalPages: 1,
				hasMore: false,
			},
		}).as("latestFeed");

		cy.visit("/discover");
		cy.wait("@latestFeed");
		cy.contains("Reposted from Original Author").should("be.visible");
		cy.contains("Original body").should("be.visible");
	});

	it("resets document scroll when switching from Latest to Trending", () => {
		const emptyPage = {
			statusCode: 200,
			body: {
				data: [],
				page: 1,
				limit: 10,
				total: 0,
				totalPages: 0,
				hasMore: false,
			},
		};

		cy.intercept("GET", "/api/users/me", {
			statusCode: 401,
			body: { message: "Authentication required" },
		}).as("currentUser");
		cy.intercept("POST", "/api/users/refresh", {
			statusCode: 401,
			body: { message: "Authentication required" },
		});
		cy.intercept({ method: "GET", pathname: "/api/feed/new" }, emptyPage).as("latestFeed");
		cy.intercept({ method: "GET", pathname: "/api/feed/trending" }, emptyPage).as("trendingFeed");

		cy.visit("/discover");
		cy.wait("@currentUser");
		cy.wait("@latestFeed");
		cy.document().then((document) => {
			const spacer = document.createElement("div");
			spacer.style.height = "2000px";
			document.body.appendChild(spacer);
		});
		cy.window().then((window) => {
			window.scrollTo({ top: 500, behavior: "auto" });
		});
		cy.window().its("scrollY").should("be.greaterThan", 0);

		cy.get('[role="tab"]').contains("Trending").click();
		cy.wait("@trendingFeed");
		cy.window().its("scrollY").should("equal", 0);
	});

	it("does not render a community placeholder for standalone profile posts", () => {
		const profile = {
			publicId: "profile-user",
			handle: "plain-user",
			username: "Plain User",
			avatar: "",
			cover: "",
			bio: "",
			createdAt: "2026-01-01T12:00:00.000Z",
			postCount: 1,
			followerCount: 0,
			followingCount: 0,
		};

		cy.intercept("GET", "**/api/users/profile/plain-user", profile).as("profile");
		cy.intercept("GET", "**/api/posts/user/profile-user*", {
			data: [
				{
					...basePost,
					publicId: "standalone-post",
					body: "Standalone post",
					type: "original",
					repostCount: 0,
					createdAt: "2026-01-02T12:00:00.000Z",
					user: {
						publicId: "profile-user",
						handle: "plain-user",
						username: "Plain User",
						avatar: "",
					},
					image: null,
					community: {},
				},
			],
			total: 1,
			page: 1,
			limit: 10,
			totalPages: 1,
			profile,
		}).as("profilePosts");

		cy.visit("/profile/plain-user");
		cy.wait(["@profile", "@profilePosts"]);
		cy.get("main").within(() => {
			cy.contains("Standalone post").should("be.visible");
			cy.get('[data-testid="GroupsIcon"]').should("not.exist");
		});
	});

	it("uses document scrolling on mobile so native pull-to-refresh can run", () => {
		cy.viewport(390, 844);
		cy.visit("/");
		cy.get("body").should("have.css", "overscroll-behavior-y", "auto");
		cy.get("main").should("have.css", "overflow", "visible");
	});

	it("restores a deep Home card after PostView Back at its prior viewport position", () => {
		const targetId = "home-target";
		let homeFeedRequests = 0;
		let requestsBeforePost = 0;
		const posts = Array.from({ length: 14 }, (_, index) =>
			makeTextPost(
				index === 8 ? targetId : `home-post-${index}`,
				index === 8 ? "Deep Home target" : `Home feed item ${index}`,
			),
		);
		const targetPost = posts[8];

		stubAnonymousAuth();
		cy.intercept("GET", "**/api/feed/new*", (request) => {
			homeFeedRequests += 1;
			request.reply({ statusCode: 200, body: feedPage(posts) });
		}).as("homeFeed");
		cy.intercept("GET", `**/api/posts/${targetId}`, {
			statusCode: 200,
			body: targetPost,
		}).as("postDetail");
		cy.intercept("GET", `**/api/posts/${targetId}/comments*`, {
			statusCode: 200,
			body: emptyCommentsPage,
		});

		cy.visit("/");
		cy.wait("@currentUser");
		cy.wait("@homeFeed");
		cy.contains("Deep Home target").should("be.visible");

		let initialViewportTop = 0;
		cy.get(`[data-feed-card-id="${targetId}"]`)
			.scrollIntoView({ offset: { top: 180, left: 0 } })
			.should("be.visible")
			.then(($card) => {
				initialViewportTop = $card[0].getBoundingClientRect().top;
				expect(initialViewportTop).to.be.greaterThan(0);
			});
		cy.window().its("scrollY").should("be.greaterThan", 0);
		cy.window().then((window) => {
			window.history.scrollRestoration = "manual";
		});
		cy.then(() => {
			requestsBeforePost = homeFeedRequests;
		});

		cy.get(`[data-feed-card-id="${targetId}"]`).click();
		cy.location("pathname").should("eq", `/posts/${targetId}`);
		cy.wait("@postDetail");
		cy.window().then((window) => window.scrollTo({ top: 0, behavior: "auto" }));
		cy.get('button[aria-label="Go back"]').should("be.visible").click();
		cy.location("pathname").should("eq", "/");

		cy.get(`[data-feed-card-id="${targetId}"]`)
			.should("be.visible")
			.should(($card) => {
				const restoredViewportTop = $card[0].getBoundingClientRect().top;
				expect(restoredViewportTop).to.be.closeTo(initialViewportTop, 4);
			});
		cy.then(() => expect(homeFeedRequests).to.equal(requestsBeforePost));
		cy.window().then((window) => {
			window.history.scrollRestoration = "auto";
		});
	});

	it("does not claim there are New posts solely because a restored Home query is stale", () => {
		const targetId = "stale-home-target";
		const oldPosts = Array.from({ length: 14 }, (_, index) =>
			makeTextPost(
				index === 8 ? targetId : `stale-home-post-${index}`,
				index === 8 ? "Stale Home target" : `Stale Home item ${index}`,
			),
		);
		const targetPost = oldPosts[8];
		let homeFeedRequests = 0;
		let requestsBeforePost = 0;

		stubAnonymousAuth();
		cy.intercept("GET", "**/api/feed/new*", (request) => {
			homeFeedRequests += 1;
			request.reply({
				statusCode: 200,
				body: feedPage(oldPosts),
			});
		}).as("homeFeed");
		cy.intercept("GET", `**/api/posts/${targetId}`, {
			statusCode: 200,
			body: targetPost,
		}).as("postDetail");
		cy.intercept("GET", `**/api/posts/${targetId}/comments*`, {
			statusCode: 200,
			body: emptyCommentsPage,
		});

		cy.visit("/");
		cy.wait("@currentUser");
		cy.wait("@homeFeed");
		cy.get(`[data-feed-card-id="${targetId}"]`)
			.scrollIntoView({ offset: { top: 180, left: 0 } })
			.should("be.visible");
		cy.window().its("scrollY").should("be.greaterThan", 0);
		cy.window().then((window) => {
			window.history.scrollRestoration = "manual";
		});
		cy.then(() => {
			requestsBeforePost = homeFeedRequests;
		});

		cy.get(`[data-feed-card-id="${targetId}"]`).click();
		cy.location("pathname").should("eq", `/posts/${targetId}`);
		cy.wait("@postDetail");
		cy.window().then((window) => window.scrollTo({ top: 0, behavior: "auto" }));
		cy.get('button[aria-label="Go back"]').should("be.visible").click();
		cy.location("pathname").should("eq", "/");

		cy.get("[data-feed-new-posts]").should("not.exist");
		cy.contains("Stale Home target").should("be.visible");
		cy.then(() => expect(homeFeedRequests).to.equal(requestsBeforePost));
		cy.window().then((window) => {
			window.history.scrollRestoration = "auto";
		});
	});

	it("prepends a deliberate Latest delta without discarding the existing snapshot", () => {
		const oldPost = makeTextPost("latest-old", "Existing Latest post");
		const newPost = makeTextPost("latest-new", "Newly refreshed Latest post");

		stubAuthenticatedAuth();
		cy.intercept(
			{ method: "GET", pathname: "/api/feed/new" },
			(request) => {
				const isRefresh = request.query.refresh === "true";
				request.alias = isRefresh ? "latestRefresh" : "latestInitial";
				request.reply({
					statusCode: 200,
					body: feedPage(isRefresh ? [newPost] : [oldPost]),
				});
			},
		);

		cy.visit("/discover?feed=latest");
		cy.wait("@currentUser");
		cy.wait("@latestInitial");
		cy.wait("@latestInitial");
		cy.contains("Existing Latest post").should("be.visible");

		cy.get('button[aria-label="Refresh latest posts"]').click();
		cy.wait("@latestRefresh");
		cy.contains("Newly refreshed Latest post").should("be.visible");
		cy.contains("Existing Latest post").should("be.visible");
	});
});
