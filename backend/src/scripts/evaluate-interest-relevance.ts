import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyContent, isInterestId, type InterestId } from "@/services/feed/interests.policy";

export interface RelevanceCase {
  id: string;
  category: string;
  body: string;
  tags: string[];
  hasImage: boolean;
  expectedTopics: InterestId[];
}

interface RelevanceSummary {
  cases: number; exactMatches: number; truePositives: number; falsePositives: number; falseNegatives: number;
  precision: number | null; recall: number | null; f1: number | null;
}
interface RelevanceEvaluation {
  summary: RelevanceSummary;
  categories: Record<string, RelevanceSummary>;
  rows: (RelevanceCase & { actualTopics: InterestId[]; features: ReturnType<typeof classifyContent>;
    truePositives: InterestId[]; falsePositives: InterestId[]; falseNegatives: InterestId[]; exact: boolean })[];
}

export function evaluateInterestRelevance(cases: RelevanceCase[]): RelevanceEvaluation {
  if (!Array.isArray(cases) || !cases.length) throw new Error("A nonempty labelled corpus is required");
  const ids = new Set<string>();
  const rows = cases.map(item => {
    if (typeof item?.id !== "string" || !item.id || ids.has(item.id) || typeof item.category !== "string" || !item.category
      || typeof item.body !== "string" || !Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== "string")
      || typeof item.hasImage !== "boolean" || !Array.isArray(item.expectedTopics) || item.expectedTopics.some(id => !isInterestId(id))
      || new Set(item.expectedTopics).size !== item.expectedTopics.length) throw new Error("Invalid or duplicate labelled case");
    ids.add(item.id);
    const features = classifyContent(item.body, item.tags, item.hasImage);
    const actual = features.topics.map(topic => topic.id).sort();
    const expected = [...item.expectedTopics].sort();
    const truePositives = actual.filter(id => expected.includes(id));
    const falsePositives = actual.filter(id => !expected.includes(id));
    const falseNegatives = expected.filter(id => !actual.includes(id));
    return { ...item, expectedTopics: expected, actualTopics: actual, features, truePositives, falsePositives, falseNegatives,
      exact: falsePositives.length === 0 && falseNegatives.length === 0 };
  });
  const summarize = (group: typeof rows): RelevanceSummary => {
    const tp = group.reduce((sum, row) => sum + row.truePositives.length, 0);
    const fp = group.reduce((sum, row) => sum + row.falsePositives.length, 0);
    const fn = group.reduce((sum, row) => sum + row.falseNegatives.length, 0);
    return { cases: group.length, exactMatches: group.filter(row => row.exact).length, truePositives: tp, falsePositives: fp, falseNegatives: fn,
      precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
      f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null };
  };
  return { summary: summarize(rows), categories: Object.fromEntries([...new Set(rows.map(row => row.category))].map(category =>
    [category, summarize(rows.filter(row => row.category === category))])), rows };
}

async function main(): Promise<void> {
  const corpus = process.env.RELEVANCE_CORPUS;
  const output = process.env.RELEVANCE_OUTPUT;
  if (!corpus || !output || !path.isAbsolute(output)) throw new Error("RELEVANCE_CORPUS and absolute RELEVANCE_OUTPUT are required");
  const result = evaluateInterestRelevance(JSON.parse(await readFile(corpus, "utf8")) as RelevanceCase[]);
  await writeFile(output, JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2), { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ ...result.summary, failingCases: result.rows.filter(row => !row.exact).map(row => row.id) }, null, 2)}\n`);
  if (result.summary.exactMatches !== result.summary.cases) process.exitCode = 1;
}

if (require.main === module) void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
});
