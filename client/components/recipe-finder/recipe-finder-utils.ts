// Pure helpers for the recipe finder's chat components (spec 2026-09-28 §5).
import {
  finderBlockSchema,
  type FinderAnswer,
  type FinderBlock,
  type FinderButton,
  type FinderItem,
  type FinderNotice,
  type RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";

export const FINDER_BUTTON_LABELS: Record<FinderButton, string> = {
  search_online: "Search Spoonacular",
  generate: "Generate",
  none_of_these: "None of these",
};

export function resultsHeader(source: RecipeResultsBlock["source"]): string {
  return source === "community" ? "From the community" : "From Spoonacular";
}

export function formatItemMeta(item: FinderItem): string {
  return [
    item.readyInMinutes ? `${item.readyInMinutes} min` : null,
    item.calories !== null ? `${item.calories} cal` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function itemAccessibilityLabel(item: FinderItem): string {
  const parts = [item.title];
  if (item.readyInMinutes) parts.push(`${item.readyInMinutes} minutes`);
  if (item.calories !== null) parts.push(`${item.calories} calories`);
  return `${parts.join(", ")}. Opens recipe.`;
}

export function noticeText(
  notice: FinderNotice | null,
  source: RecipeResultsBlock["source"],
): string | null {
  switch (notice) {
    case "no_matches":
      return source === "community"
        ? "No community recipes matched."
        : "Spoonacular had no matches.";
    case "unavailable":
      return "Spoonacular isn't available right now. Try Generate or a community pick.";
    case "generate_limit":
      return "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.";
    case "generate_premium":
      return "Generating recipes is a Premium feature.";
    default:
      return null;
  }
}

export function resultsAnnouncement(block: RecipeResultsBlock): string {
  const n = block.items.length;
  if (n === 0) {
    return noticeText(block.notice, block.source) ?? "No recipes found";
  }
  const where = block.source === "community" ? "community" : "Spoonacular";
  return `Found ${n} ${where} recipe${n === 1 ? "" : "s"}`;
}

export function answersLabel(answers: FinderAnswer[]): string {
  return answers.map((a) => a.answer).join(", ");
}

export function finderItemNavParams(item: FinderItem): {
  recipeId: number;
  recipeType: "community" | "catalog";
} {
  return {
    recipeId: item.id,
    recipeType: item.source === "spoonacular" ? "catalog" : "community",
  };
}

/** RecipeChef stores `{metadataVersion, finder}`; Coach stores `{blocks:[…]}`. */
export function finderBlockFromMessageMetadata(
  metadata: unknown,
): FinderBlock | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  const direct = finderBlockSchema.safeParse(m.finder);
  if (direct.success) return direct.data;
  if (Array.isArray(m.blocks)) {
    for (const b of m.blocks) {
      const parsed = finderBlockSchema.safeParse(b);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

export function lockedFinderButtons(opts: {
  canSearchOnline: boolean;
  canGenerate: boolean;
}): FinderButton[] {
  const locked: FinderButton[] = [];
  if (!opts.canSearchOnline) locked.push("search_online");
  if (!opts.canGenerate) locked.push("generate");
  return locked;
}
