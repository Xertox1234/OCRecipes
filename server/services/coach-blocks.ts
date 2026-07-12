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
  // Use global flag so multiple fences in one response are all found and stripped.
  const blockPattern = /```coach_blocks\n([\s\S]*?)```/g;
  const matches = [...safeContent.matchAll(blockPattern)];

  if (matches.length === 0) {
    return { text: safeContent.trim(), blocks: [] };
  }

  const text = safeContent.replace(blockPattern, "").trim();
  const allBlocks: CoachBlock[] = [];

  for (const match of matches) {
    try {
      const rawBlocks = JSON.parse(match[1]);
      if (Array.isArray(rawBlocks)) {
        allBlocks.push(...validateBlocks(rawBlocks));
      }
    } catch {
      logger.debug("Failed to parse coach blocks JSON");
    }
  }

  return { text, blocks: allBlocks };
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
- Include blocks only when they add value — don't force a fence into every response
- When you DO emit a coach_blocks fence, it must contain a quick_replies block with 2-3 contextual follow-up options; include other block types only when they add value
- Place the coach_blocks fence after your text response
- For recipe suggestions, use search_recipes tool first to get real recipe data
- For nutrition data, use lookup_nutrition tool first for accuracy

Example response (match this format exactly — prose first, then the fence):
You're at 1,400 of 2,000 cal with 60g protein still to go — dinner has room for something substantial.
\`\`\`coach_blocks
[{"type":"quick_replies","options":[{"label":"Dinner ideas","message":"Suggest a dinner that fits my remaining macros"},{"label":"Show my progress","message":"How is my day looking so far?"}]}]
\`\`\`
`.trim();
