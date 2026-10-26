import { describe, it } from "mocha";
import { expect } from "chai";
import { classifyContent, decayedSignalWeight } from "@/services/feed/interests.policy";

describe("Interest content policy", () => {
  it("classifies untagged posts and gives prose more evidence than hashtags", () => {
    expect(classifyContent("Ethereum transaction fees", [], false).topics).to.deep.equal([{ id: "crypto", weight: 0.6 }]);
    expect(classifyContent("#crypto", [], true)).to.deep.equal({ version: 2, topics: [{ id: "crypto", weight: 0.2 }], format: "image" });
    expect(classifyContent("Stock market inflation and bitcoin", [], false).topics.map((topic) => topic.id)).to.deep.equal(["finance", "crypto"]);
  });

  it("recognizes Bulgarian and whole phrases without matching substrings", () => {
    expect(classifyContent("Избори и правителство", [], false).topics).to.deep.equal([{ id: "politics", weight: 1 }]);
    expect(classifyContent("This is a chair, not a fairytale", [], false).topics).to.deep.equal([]);
    expect(classifyContent("Artificial intelligence", [], false).topics.map((topic) => topic.id)).to.deep.equal(["technology"]);
  });

  it("keeps image format independent of subject and ignores repeated keyword stuffing", () => {
    expect(classifyContent("#finance", [], true).format).to.equal("image");
    expect(classifyContent("Investment analysis", [], true).format).to.equal("mixed");
    expect(classifyContent("bitcoin bitcoin bitcoin", [], false).topics).to.deep.equal([{ id: "crypto", weight: 0.6 }]);
    expect(classifyContent("#meme", [], true).topics).to.deep.equal([]);
  });

  it("decays interaction evidence with a thirty-day half-life", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(decayedSignalWeight("like", at, new Date("2026-01-31T00:00:00Z"))).to.equal(1.5);
    expect(decayedSignalWeight("repost", at, at)).to.equal(2);
  });

  it("counts matching tags once and does not treat hashtag text as prose", () => {
    expect(classifyContent("#crypto #bitcoin #ethereum", ["crypto", "crypto"], false).topics)
      .to.deep.equal([{ id: "crypto", weight: 0.2 }]);
    expect(classifyContent("Ethereum #crypto", [], false).topics)
      .to.deep.equal([{ id: "crypto", weight: 0.8 }]);
    expect(classifyContent("Investments in software", [], false).topics)
      .to.deep.equal([{ id: "finance", weight: 0.6 }, { id: "technology", weight: 0.6 }]);
  });

  it("recognizes curated English and Bulgarian word forms as complete phrases", () => {
    for (const [body, id] of [["Investments", "finance"], ["interest rate", "finance"], ["stock markets", "finance"],
      ["Governments", "politics"], ["Technologies", "technology"], ["Cryptocurrencies", "crypto"],
      ["Video games", "gaming"], ["Workouts", "health"], ["Инвестирам", "finance"],
      ["Правителствата", "politics"], ["Тренировките", "health"], ["Фотографията", "culture"]]) {
      expect(classifyContent(body, [], false).topics, body).to.deep.equal([{ id, weight: 0.6 }]);
    }
  });

  it("counts variants of a dictionary entry once in prose and once in tags", () => {
    expect(classifyContent("investment investments investments", [], false).topics).to.deep.equal([{ id: "finance", weight: 0.6 }]);
    expect(classifyContent("правителство правителството правителства", [], false).topics).to.deep.equal([{ id: "politics", weight: 0.6 }]);
    expect(classifyContent("#investment #investments", ["investments"], true)).to.deep.equal({
      version: 2, topics: [{ id: "finance", weight: 0.2 }], format: "image",
    });
    expect(classifyContent("Investments #investment #investments", [], false).topics).to.deep.equal([{ id: "finance", weight: 0.8 }]);
  });

  it("keeps word boundaries and treats negative sentiment as topic evidence", () => {
    expect(classifyContent("investments_archive governments_backup cryptocurrencies_v2 тренировките_старо", [], false).topics).to.deep.equal([]);
    expect(classifyContent("I do not support bitcoin", [], false).topics).to.deep.equal([{ id: "crypto", weight: 0.6 }]);
  });
});
