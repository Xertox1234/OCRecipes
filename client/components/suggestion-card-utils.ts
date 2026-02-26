/**
 * Pure mapping utilities for SuggestionCard.
 * Maps suggestion type → icon name, type label, saved-item type.
 */

type SuggestionType = "recipe" | "craft" | "pairing";

/** Feather icon name for each suggestion type. */
export function getSuggestionIconName(
  type: SuggestionType,
): "book-open" | "scissors" | "coffee" {
  switch (type) {
    case "recipe":
      return "book-open";
    case "craft":
      return "scissors";
    default:
      return "coffee";
  }
}

/** Human-readable label. "craft" → "Kid Activity". */
export function getSuggestionTypeLabel(type: SuggestionType): string {
  if (type === "craft") return "Kid Activity";
  return type;
}

/** Map suggestion type to saved-item type. "craft" → "activity". */
export function mapSuggestionToSavedItemType(
  type: SuggestionType,
): "recipe" | "activity" {
  return type === "craft" ? "activity" : "recipe";
}
