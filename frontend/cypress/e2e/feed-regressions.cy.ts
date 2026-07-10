const basePost = {
	tags: [],
	likes: 0,
	commentsCount: 0,
	viewsCount: 0,
	isLikedByViewer: false,
	isFavoritedByViewer: false,
	isRepostedByViewer: false,
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
});
