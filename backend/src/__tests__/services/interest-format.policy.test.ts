import { describe, it } from "mocha";
import { expect } from "chai";
import { interestFormatShares, mixInterestFormats } from "@/services/feed/interest-ranking.policy";
import type { ContentFormat, InterestProfile } from "@/services/feed/interests.policy";

function profile(formats: InterestProfile["formats"]): InterestProfile {
  return { selected: ["crypto"], topics: { crypto: 3 }, formats, revision: 1 };
}

function candidate(id: string, format: ContentFormat, matched = true) {
  return { id, contentFeatures: { version: 1, format, topics: [{ id: matched ? "crypto" as const : "finance" as const, weight: 1 }] },
    rankBreakdown: { freshness: 0.3, popularity: 0, topic: matched ? 0.4 : 0, format: 0 } };
}

describe("Personalized format allocation", () => {
  const affinities = new Map([["crypto", 1]]);
  it("leaves cold-start ranking alone and softens sparse evidence toward a uniform mix", () => {
    expect(interestFormatShares(undefined)).to.equal(undefined);
    expect(interestFormatShares(profile({}))).to.equal(undefined);
    const sparse = interestFormatShares(profile({ image: 3 }))!;
    expect(sparse.image).to.be.closeTo(2 / 3, 1e-12);
    expect(sparse.text).to.be.greaterThan(0);
    expect(sparse.mixed).to.be.greaterThan(0);
    const established = interestFormatShares(profile({ image: 30 }))!;
    expect(established.image).to.be.greaterThan(sparse.image);
    expect(Object.values(established).reduce((sum, share) => sum + share, 0)).to.be.closeTo(1, 1e-12);
  });

  it("reflects image-heavy learning while retaining within-format order and every candidate", () => {
    const entries = (["text", "mixed", "image"] as const).flatMap(format =>
      Array.from({ length: 12 }, (_, index) => candidate(`${format}-${index}`, format)));
    const original = structuredClone(entries);
    const result = mixInterestFormats(entries, interestFormatShares(profile({ image: 24, text: 3, mixed: 3 }))!, affinities);
    expect(result.slice(0, 10).filter(entry => entry.contentFeatures.format === "image")).to.have.length.of.at.least(6);
    expect(result.slice(0, 10).some(entry => entry.contentFeatures.format === "text")).to.equal(true);
    expect(result.slice(0, 10).some(entry => entry.contentFeatures.format === "mixed")).to.equal(true);
    for (const format of ["text", "mixed", "image"]) {
      expect(result.filter(entry => entry.contentFeatures.format === format).map(entry => entry.id))
        .to.deep.equal(entries.filter(entry => entry.contentFeatures.format === format).map(entry => entry.id));
    }
    expect(result.map(entry => entry.id)).to.have.members(entries.map(entry => entry.id));
    expect(new Set(result.map(entry => entry.id)).size).to.equal(entries.length);
    expect(entries).to.deep.equal(original);
  });

  it("keeps unrelated and unclassified slots in place instead of filling topic slots with other images", () => {
    const entries = [candidate("text-1", "text"), candidate("other-image", "image", false),
      { id: "legacy", contentFeatures: undefined, rankBreakdown: undefined },
      candidate("text-2", "text"), candidate("matching-image", "image"), candidate("text-3", "text")];
    const result = mixInterestFormats(entries, interestFormatShares(profile({ image: 30 }))!, affinities);
    expect(result[1].id).to.equal("other-image");
    expect(result[2].id).to.equal("legacy");
    expect(result[0].id).to.equal("matching-image");
    expect(result.filter(entry => entry.id.startsWith("text")).map(entry => entry.id)).to.deep.equal(["text-1", "text-2", "text-3"]);
    expect(new Set(result.map(entry => entry.id)).size).to.equal(entries.length);
  });

  it("allocates balanced evidence across the prefix even when the base list is grouped by format", () => {
    const entries = (["text", "mixed", "image"] as const).flatMap(format =>
      Array.from({ length: 5 }, (_, index) => candidate(`${format}-${index}`, format)));
    const result = mixInterestFormats(entries, interestFormatShares(profile({ image: 3, text: 3, mixed: 3 }))!, affinities).slice(0, 9);
    for (const format of ["text", "mixed", "image"]) {
      expect(result.filter(entry => entry.contentFeatures.format === format)).to.have.length(3);
    }
  });

  it("does not let a weaker topic's images take over a stronger topic's slots", () => {
    const financeText = Array.from({ length: 8 }, (_, index) => ({ ...candidate(`finance-${index}`, "text"),
      contentFeatures: { version: 1, format: "text" as const, topics: [{ id: "finance" as const, weight: 1 }] } }));
    const cryptoImages = Array.from({ length: 8 }, (_, index) => ({ ...candidate(`crypto-${index}`, "image"),
      contentFeatures: { version: 1, format: "image" as const, topics: [{ id: "crypto" as const, weight: 0.2 }] } }));
    const result = mixInterestFormats([...financeText, ...cryptoImages], interestFormatShares(profile({ image: 30 }))!, new Map([["finance", 0.9], ["crypto", 0.1]]));
    expect(result.slice(0, 8).map(entry => entry.id)).to.deep.equal(financeText.map(entry => entry.id));
  });
});
