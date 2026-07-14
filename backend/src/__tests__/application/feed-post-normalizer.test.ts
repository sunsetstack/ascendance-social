import { expect } from "chai";
import { normalizeFeedPost } from "@/application/queries/feed/feed-post-normalizer";

describe("normalizeFeedPost", () => {
  it("preserves valid image dimensions for posts and reposts", () => {
    const post = normalizeFeedPost({
      publicId: "post-id",
      user: {
        publicId: "user-id",
        username: "user",
        handle: "user",
      },
      image: {
        publicId: "image-id",
        url: "https://example.com/post.jpg",
        slug: "post",
        width: 1920,
        height: 1080,
      },
      repostOf: {
        publicId: "original-id",
        user: {
          publicId: "original-user-id",
          username: "original",
          handle: "original",
        },
        image: {
          publicId: "original-image-id",
          url: "https://example.com/original.jpg",
          slug: "original",
          width: 800,
          height: 1200,
        },
      },
    });

    expect(post.image).to.include({ width: 1920, height: 1080 });
    expect(post.repostOf?.image).to.include({ width: 800, height: 1200 });
  });
});
