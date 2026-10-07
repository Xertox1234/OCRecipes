export const COOKING_TIME_IDS = ["quick", "moderate", "leisurely"] as const;
export type CookingTimeId = (typeof COOKING_TIME_IDS)[number];
export const COOKING_TIMES: {
  id: CookingTimeId;
  name: string;
  description: string;
}[] = [
  { id: "quick", name: "Quick", description: "Under 30 minutes" },
  { id: "moderate", name: "Moderate", description: "30-60 minutes" },
  { id: "leisurely", name: "Leisurely", description: "1+ hours, no rush" },
];
