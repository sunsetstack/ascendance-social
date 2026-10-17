export const INTEREST_POLICY_VERSION = 1;

export const INTERESTS = [
  { id: "finance", name: "Business & finance", nameBg: "Бизнес и финанси", keywords: ["business", "finance", "investing", "investment", "stock market", "interest rates", "inflation", "entrepreneur", "startup", "бизнес", "финанси", "инвестиции", "инфлация"], tags: ["business", "finance", "investing", "stocks", "economy"] },
  { id: "crypto", name: "Crypto", nameBg: "Криптовалути", keywords: ["crypto", "bitcoin", "ethereum", "blockchain", "cryptocurrency", "web3", "крипто", "биткойн", "блокчейн"], tags: ["crypto", "bitcoin", "ethereum", "blockchain", "web3"] },
  { id: "politics", name: "World politics", nameBg: "Световна политика", keywords: ["politics", "election", "parliament", "government", "geopolitics", "foreign policy", "diplomacy", "политика", "избори", "парламент", "правителство"], tags: ["politics", "elections", "geopolitics", "worldnews"] },
  { id: "technology", name: "Technology", nameBg: "Технологии", keywords: ["technology", "software", "programming", "artificial intelligence", "machine learning", "typescript", "javascript", "open source", "технологии", "софтуер", "програмиране", "изкуствен интелект"], tags: ["tech", "technology", "coding", "programming", "ai"] },
  { id: "science", name: "Science & nature", nameBg: "Наука и природа", keywords: ["science", "astronomy", "physics", "biology", "climate", "wildlife", "biodiversity", "наука", "астрономия", "физика", "биология", "климат", "природа"], tags: ["science", "nature", "space", "climate", "wildlife"] },
  { id: "health", name: "Health & fitness", nameBg: "Здраве и спортна форма", keywords: ["fitness", "workout", "nutrition", "mental health", "wellbeing", "marathon", "здраве", "фитнес", "тренировка", "хранене"], tags: ["health", "fitness", "wellbeing", "nutrition"] },
  { id: "culture", name: "Arts & culture", nameBg: "Изкуство и култура", keywords: ["cinema", "photography", "literature", "painting", "concert", "music", "изкуство", "култура", "кино", "фотография", "литература", "музика"], tags: ["art", "culture", "music", "movies", "photography", "books"] },
  { id: "sports", name: "Sports", nameBg: "Спорт", keywords: ["football", "basketball", "tennis", "championship", "olympics", "футбол", "баскетбол", "тенис", "първенство", "олимпиада"], tags: ["sports", "football", "basketball", "tennis"] },
  { id: "gaming", name: "Gaming", nameBg: "Игри", keywords: ["gaming", "video game", "videogames", "esports", "playstation", "xbox", "nintendo", "arknights", "гейминг", "видеоигри"], tags: ["gaming", "games", "esports", "arknights"] },
] as const;

export type InterestId = typeof INTERESTS[number]["id"];
export type ContentFormat = "text" | "image" | "mixed";
export interface ContentFeatures {
  version: number;
  topics: { id: InterestId; weight: number }[];
  format: ContentFormat;
}
export interface InterestProfile {
  selected: string[];
  topics: Record<string, number>;
  formats: Partial<Record<ContentFormat, number>>;
  revision: number;
}
export interface InterestFeedDefinition {
  destination?: "home" | "for-you";
  topics: string[];
  sort: "newest" | "top" | "personalized";
  viewer?: string;
  viewerMongoId?: string;
  profile?: InterestProfile;
}

export function isInterestId(value: string): value is InterestId {
  return INTERESTS.some((interest) => interest.id === value);
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(text);
}

export function classifyContent(body: string, tags: string[], hasImage: boolean): ContentFeatures {
  const text = normalize(body.replace(/#[\p{L}\p{N}_]+/gu, " "));
  const normalizedTags = new Set([
    ...tags.map((tag) => normalize(tag.replace(/^#/, ""))),
    ...Array.from(body.matchAll(/#([\p{L}\p{N}_]+)/gu), (match) => normalize(match[1])),
  ]);
  const topics = INTERESTS.flatMap((interest) => {
    const keywordMatches = interest.keywords.filter((word) => containsPhrase(text, word)).length;
    const tagMatch = [...interest.tags, ...interest.keywords].some((tag) => normalizedTags.has(tag));
    const weight = Math.min(1, keywordMatches * 0.6 + (tagMatch ? 0.2 : 0));
    return weight > 0 ? [{ id: interest.id, weight }] : [];
  });
  return {
    version: INTEREST_POLICY_VERSION,
    topics,
    format: hasImage ? (text.trim() ? "mixed" : "image") : "text",
  };
}

export function decayedSignalWeight(kind: "like" | "repost", at: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - at.getTime()) / 86_400_000);
  return (kind === "like" ? 3 : 2) * Math.pow(0.5, ageDays / 30);
}

export function classifyRepostContent(body: string, hasImage: boolean, original: ContentFeatures): ContentFeatures {
  const own = classifyContent(body, [], hasImage);
  const ordinary = !body.trim() && !hasImage;
  const topics = new Map(original.topics.map((topic) => [topic.id, topic.weight * (ordinary ? 1 : 0.5)]));
  for (const topic of own.topics) topics.set(topic.id, Math.max(topics.get(topic.id) ?? 0, topic.weight));
  return { version: INTEREST_POLICY_VERSION, format: ordinary ? original.format : own.format,
    topics: [...topics].map(([id, weight]) => ({ id, weight })) };
}
