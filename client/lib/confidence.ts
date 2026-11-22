import * as Haptics from "expo-haptics";
import { Colors } from "@/constants/theme";

type Theme = (typeof Colors)["light"] | (typeof Colors)["dark"];

export type ConfidenceTier = "high" | "medium" | "low";

const HIGH_THRESHOLD = 0.8;
const MEDIUM_THRESHOLD = 0.5;

export function getConfidenceTier(score: number): ConfidenceTier {
  if (score >= HIGH_THRESHOLD) return "high";
  if (score >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}

// Every caller draws this as TEXT (or a small dot) on a 0.12 tint of the same
// colour, so it returns the badge*Text tokens, which are AA on that tint in
// both modes. Plain `warning`/`error` are not (2.51:1 / 3.87:1 in light mode).
export function getConfidenceColor(theme: Theme, tier: ConfidenceTier): string {
  const tierColors: Record<ConfidenceTier, string> = {
    high: theme.badgeSuccessText,
    medium: theme.badgeWarningText,
    low: theme.badgeErrorText,
  };
  return tierColors[tier];
}

export function getConfidenceLabel(tier: ConfidenceTier): string {
  const labels: Record<ConfidenceTier, string> = {
    high: "High",
    medium: "Medium",
    low: "Low",
  };
  return labels[tier];
}

// Low still gets Warning, not silence — a silent low-confidence result would
// leave the worst case with zero completion feedback at all.
export function getConfidenceHapticType(
  tier: ConfidenceTier,
): Haptics.NotificationFeedbackType {
  return tier === "high"
    ? Haptics.NotificationFeedbackType.Success
    : Haptics.NotificationFeedbackType.Warning;
}
