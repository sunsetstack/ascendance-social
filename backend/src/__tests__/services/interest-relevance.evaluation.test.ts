import { describe, it } from "mocha";
import { expect } from "chai";
import { evaluateInterestRelevance, type RelevanceCase } from "@/scripts/evaluate-interest-relevance";

describe("Labelled interest relevance evaluation", () => {
  it("counts missing and extra topics without relabelling the expected corpus", () => {
    const cases: RelevanceCase[] = [
      { id: "literal", category: "literal", body: "Bitcoin", tags: [], hasImage: false, expectedTopics: ["crypto"] },
      { id: "missing", category: "arithmetic", body: "", tags: [], hasImage: false, expectedTopics: ["finance"] },
      { id: "extra", category: "context", body: "Finance", tags: [], hasImage: false, expectedTopics: [] },
      { id: "overlap", category: "context", body: "Bitcoin software", tags: [], hasImage: false, expectedTopics: ["crypto"] },
    ];
    const original = structuredClone(cases);
    const result = evaluateInterestRelevance(cases);
    expect(result.summary).to.deep.equal({ cases: 4, exactMatches: 1, truePositives: 2, falsePositives: 2, falseNegatives: 1,
      precision: 0.5, recall: 2 / 3, f1: 4 / 7 });
    expect(result.rows.filter(row => !row.exact).map(row => row.id)).to.deep.equal(["missing", "extra", "overlap"]);
    expect(result.categories.context.falsePositives).to.equal(2);
    expect(cases).to.deep.equal(original);
  });

  it("does not turn an all-neutral corpus into invented precision or recall", () => {
    const result = evaluateInterestRelevance([{ id: "neutral", category: "neutral", body: "Made soup.", tags: [], hasImage: false, expectedTopics: [] }]);
    expect(result.summary.exactMatches).to.equal(1);
    expect(result.summary.precision).to.equal(null);
    expect(result.summary.recall).to.equal(null);
    expect(result.summary.f1).to.equal(null);
  });

  it("rejects empty, duplicate or invalid labels instead of dropping those cases", () => {
    const item: RelevanceCase = { id: "fixture", category: "literal", body: "Bitcoin", tags: [], hasImage: false, expectedTopics: ["crypto"] };
    expect(() => evaluateInterestRelevance([])).to.throw("nonempty");
    expect(() => evaluateInterestRelevance([item, item])).to.throw("duplicate");
    expect(() => evaluateInterestRelevance([{ ...item, expectedTopics: ["invented"] } as unknown as RelevanceCase])).to.throw("Invalid");
  });
});
