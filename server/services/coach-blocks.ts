// server/services/coach-blocks.ts
import {
  coachBlockSchema,
  type CoachBlock,
} from "@shared/schemas/coach-blocks";
import { logger } from "../lib/logger";

export function validateBlocks(rawBlocks: unknown[]): CoachBlock[] {
  const valid: CoachBlock[] = [];
  for (const block of rawBlocks) {
    const result = coachBlockSchema.safeParse(block);
    if (result.success) {
      valid.push(result.data);
    } else {
      logger.debug(
        { block, error: result.error.message },
        "Dropped invalid coach block",
      );
    }
  }
  return valid;
}

/** Maximum length of content scanned for coach_blocks fences (defense-in-depth
 *  against theoretical ReDoS on unterminated fences). Responses are already
 *  capped at 1500 tokens upstream, but this explicit guard makes the limit
 *  local and auditable. L4 — 2026-04-18. */
const MAX_BLOCKS_CONTENT_LENGTH = 16_000;

export function parseBlocksFromContent(content: string): {
  text: string;
  blocks: CoachBlock[];
} {
  // L4: cap length before running the regex to bound backtracking on
  // unterminated fences.
  const safeContent =
    content.length > MAX_BLOCKS_CONTENT_LENGTH
      ? content.slice(0, MAX_BLOCKS_CONTENT_LENGTH)
      : content;
  const blockPattern = /```coach_blocks\n([\s\S]*?)```/;
  const match = safeContent.match(blockPattern);

  if (!match) {
    return { text: safeContent.trim(), blocks: [] };
  }

  const text = safeContent.replace(blockPattern, "").trim();

  try {
    const rawBlocks = JSON.parse(match[1]);
    if (!Array.isArray(rawBlocks)) {
      return { text, blocks: [] };
    }
    return { text, blocks: validateBlocks(rawBlocks) };
  } catch {
    logger.debug("Failed to parse coach blocks JSON");
    return { text, blocks: [] };
  }
}

export const BLOCKS_SYSTEM_PROMPT = `
When appropriate, you can include structured interactive content blocks in your response.
To do this, add a fenced code block with the language tag \`coach_blocks\` containing a JSON array of block objects.

Available block types:
- action_card: { type: "action_card", title, subtitle, action: { type: "log_food"|"navigate"|"set_goal"|"add_meal_plan"|"add_grocery_list", ... }, actionLabel }
- suggestion_list: { type: "suggestion_list", items: [{ title, subtitle, action: { type: "navigate", screen, params } | null }] }
- inline_chart: { type: "inline_chart", chartType: "bar"|"progress"|"stat_row", title, data: [{ label, value, target?, hit? }], summary? }
- commitment_card: { type: "commitment_card", title, followUpText, followUpDate: "YYYY-MM-DD" }
- quick_replies: { type: "quick_replies", options: [{ label, message }] }
- recipe_card: { type: "recipe_card", recipe: { title, calories, protein, prepTime, imageUrl, recipeId, source: "community"|"spoonacular"|"generated" } }
- meal_plan_card: { type: "meal_plan_card", title, days: [{ label, meals: [{ type, title, calories, protein }], totals: { calories, protein } }] }

Rules:
- Only include blocks when they add value (don't force them into every response)
- Place the coach_blocks fence after your text response
- Always include quick_replies with 2-3 contextual follow-up options
- For recipe suggestions, use search_recipes tool first to get real recipe data
- For nutrition data, use lookup_nutrition tool first for accuracy
`.trim();
