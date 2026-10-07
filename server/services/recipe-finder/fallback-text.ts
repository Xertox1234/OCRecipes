// server/services/recipe-finder/fallback-text.ts
// §3.2: every finder message's `content` must stand on its own — an app
// build without the finder component shows exactly this text, and the typed
// "generate" / "none of these" guard is how it keeps going.
import type {
  FinderBlock,
  FinderItem,
  RecipeResultsBlock,
} from "@shared/schemas/recipe-finder";
import { COOKING_TIMES } from "@shared/constants/cooking-times";

function itemLine(item: FinderItem, index: number): string {
  const meta = [
    item.readyInMinutes ? `${item.readyInMinutes} min` : null,
    item.calories !== null ? `${item.calories} cal` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${index + 1}. ${item.title}${meta ? ` (${meta})` : ""}`;
}

function footer(block: RecipeResultsBlock): string {
  const parts: string[] = [];
  if (block.actions.includes("generate")) {
    parts.push('"generate" to create a new recipe');
  }
  if (block.actions.includes("none_of_these")) {
    parts.push(
      block.flow.round === 0
        ? '"none of these" to narrow it down'
        : '"none of these" to create one instead',
    );
  }
  return parts.length > 0 ? `\n\nReply ${parts.join(", or ")}.` : "";
}

export const OFFER_TEXT =
  "I can make this into a recipe right here in the chat. Want me to get started?\nI can also search OCRecipes for something similar.";

export function finderFallbackText(block: FinderBlock): string {
  switch (block.type) {
    case "recipe_questions": {
      const lines = block.questions.map(
        (q, i) => `${i + 1}. ${q.question} (${q.options.join(" / ")})`,
      );
      return `A few quick questions:\n${lines.join("\n")}\n\nReply with your answers, or "generate" to create a recipe now.`;
    }
    case "recipe_offer":
      return `${OFFER_TEXT}\n\nReply "yes", "search", or "no".`;
    case "recipe_adjust": {
      const dish = block.flow.dish;
      const servings = block.prefill.servings;
      const spice = block.prefill.spice;
      const timeLabel =
        COOKING_TIMES.find((t) => t.id === block.prefill.time)?.description ??
        block.prefill.time;
      return `${dish} — ${servings} servings, ${spice}, ${timeLabel}.\n\nReply "generate" to make it.`;
    }
    case "recipe_results": {
      switch (block.notice) {
        case "generate_limit":
          return "You've reached today's limit for generated recipes. Community and Spoonacular searches still work.";
        case "generate_premium":
          return "Generating recipes is a Premium feature. Try a community pick instead.";
        case "unavailable":
          return `Spoonacular isn't available right now. Try Generate or a community pick.${footer(block)}`;
        case "no_matches":
          return `${block.source === "community" ? "No community recipes matched." : "Spoonacular had no matches."}${footer(block)}`;
        case null: {
          const n = block.items.length;
          const head =
            block.source === "community"
              ? `Here are ${n} community recipe${n === 1 ? "" : "s"}:`
              : `Here are ${n} recipe${n === 1 ? "" : "s"} from Spoonacular:`;
          return `${head}\n${block.items.map(itemLine).join("\n")}${footer(block)}`;
        }
      }
    }
  }
}
