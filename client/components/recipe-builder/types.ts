import type { ReactNode } from "react";

export type SheetSection =
  | "ingredients"
  | "instructions"
  | "timeServings"
  | "nutrition"
  | "tags";

export type SheetLifecycleState = "IDLE" | "SHEET_OPEN" | "SAVING";

export const DIET_TAG_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Gluten Free",
  "Dairy Free",
  "Keto",
  "Paleo",
  "Low Carb",
  "High Protein",
] as const;

export type DietTag = (typeof DIET_TAG_OPTIONS)[number];

/** Props for the SectionRow component */
export interface SectionRowProps {
  icon: string;
  label: string;
  summary?: string;
  renderSummary?: () => ReactNode;
  isFilled: boolean;
  onPress: () => void;
}
