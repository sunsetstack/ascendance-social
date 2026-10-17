export interface InterestCatalogueItem { id: string; name: string; nameBg: string }
export interface InterestProfile {
  selected: string[];
  topics: Record<string, number>;
  formats: Partial<Record<"text" | "image" | "mixed", number>>;
  revision: number;
}
export interface InterestsResult { catalogue: InterestCatalogueItem[]; profile: InterestProfile | null }
