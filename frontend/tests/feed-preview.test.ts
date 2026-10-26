import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultFeedPreview, readFeedPreview, writeFeedPreview } from "../src/features/feed/feedPreview.ts";
import { feedIdentities } from "../src/features/feed/feedIdentity.ts";

test("feed choices survive a URL round trip and keep the custom entry point", () => {
  const definition = { topics: ["cats", "photography"], sort: "relevant" as const, includeReposts: false };
  const params = writeFeedPreview(new URLSearchParams("feed=latest"), definition);
  assert.equal(params.get("feed"), "custom");
  assert.deepEqual(readFeedPreview(params), { definition, valid: true });
});

test("topic order and capitalization do not create different feed identities", () => {
  const a = readFeedPreview(new URLSearchParams("topic=Cats&topic=photos"));
  const b = readFeedPreview(new URLSearchParams("topic=photos&topic=cats"));
  assert.equal(feedIdentities.preview(JSON.stringify(a.definition)), feedIdentities.preview(JSON.stringify(b.definition)));
  assert.notEqual(feedIdentities.preview(JSON.stringify(a.definition), "a"), feedIdentities.preview(JSON.stringify(a.definition), "b"));
});

test("reset removes every preview restriction without discarding unrelated URL state", () => {
  const params = writeFeedPreview(new URLSearchParams("feed=custom&topic=cats&sort=relevant&reposts=hide&source=demo"), defaultFeedPreview);
  assert.deepEqual(readFeedPreview(params), { definition: defaultFeedPreview, valid: true });
  assert.equal(params.get("source"), "demo");
  assert.equal(params.has("topic"), false);
  assert.equal(params.has("sort"), false);
  assert.equal(params.has("reposts"), false);
});

test("invalid links cannot silently widen a preview", () => {
  for (const search of ["topic=", "topic=%24where", "sort=random", "sort=latest&sort=relevant", "reposts=nope", "topic=a&topic=b&topic=c&topic=d&topic=e&topic=f"]) {
    assert.equal(readFeedPreview(new URLSearchParams(search)).valid, false, search);
  }
  assert.equal(readFeedPreview(new URLSearchParams("topic=котки")).valid, true);
});
