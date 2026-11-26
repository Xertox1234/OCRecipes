// server/services/coach-blocks.ts
import {
  coachBlockSchema,
  type CoachBlock,
} from "@shared/schemas/coach-blocks";
import { isFinderBlockType } from "@shared/schemas/recipe-finder";
import { logger, toError } from "../lib/logger";
import { extractBlockFences, stripCitationMarkers } from "./coach-reply-text";
import { readDayProgressRequest, type DayProgressDay } from "./day-progress";

export function validateBlocks(rawBlocks: unknown[]): CoachBlock[] {
  const valid: CoachBlock[] = [];
  for (const block of rawBlocks) {
    // Finder blocks carry flow state the server derives the next step from;
    // a model-authored one would let model output steer the flow.
    // Write cards likewise: the server builds them from a write tool call
    // with numbers it resolved itself, so a model-authored one is dropped.
    if (
      typeof block === "object" &&
      block !== null &&
      (isFinderBlockType((block as { type?: unknown }).type) ||
        (block as { type?: unknown }).type === "write_card" ||
        (block as { type?: unknown }).type === "checked_trail" ||
        // The model asks for a day progress card by naming the day; the
        // server builds it (day-progress.ts), so one with numbers is dropped.
        (block as { type?: unknown }).type === "day_progress")
    ) {
      logger.debug(
        { type: (block as { type?: unknown }).type },
        "Dropped server-only finder block from model output",
      );
      continue;
    }
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

/**
 * Splits a model reply into the text to show and its cards. The fence is read
 * by `extractBlockFences`, which counts brackets, so a wrong closer or a reply
 * cut off inside the fence no longer leaves block JSON in the text; the
 * model's own citation markup is removed too. The scan is one linear pass,
 * so the reply is no longer cut at 16,000 characters first.
 */
export function parseBlocksFromContent(content: string): {
  text: string;
  blocks: CoachBlock[];
  /** The day of the first day_progress card the reply asked for (T3). */
  dayProgress?: DayProgressDay;
} {
  const fences = extractBlockFences(content);
  const text = stripCitationMarkers(fences.text).trim();
  const allBlocks: CoachBlock[] = [];
  let dayProgress: DayProgressDay | undefined;

  // warn, not debug: persistent model drift here silently strips every
  // interactive block, and debug is off in production.
  if (fences.truncated) {
    logger.warn(
      { err: new Error("coach_blocks fence never closed its array") },
      "Failed to parse coach blocks JSON",
    );
  }
  for (const raw of fences.arrays) {
    try {
      const rawBlocks = JSON.parse(raw);
      if (Array.isArray(rawBlocks)) {
        allBlocks.push(...validateBlocks(rawBlocks));
        for (const raw of rawBlocks) {
          dayProgress ??= readDayProgressRequest(raw);
        }
      }
    } catch (err) {
      logger.warn({ err: toError(err) }, "Failed to parse coach blocks JSON");
    }
  }

  return { text, blocks: allBlocks, ...(dayProgress && { dayProgress }) };
}

export const BLOCKS_SYSTEM_PROMPT = `
When appropriate, you can include structured interactive content blocks in your response.
To do this, add a fenced code block with the language tag \`coach_blocks\` containing a JSON array of block objects.

Available block types:
- action_card: { type: "action_card", title, subtitle, action: { type: "log_food"|"navigate"|"set_goal"|"add_meal_plan"|"add_grocery_list"|"add_allergy", ... }, actionLabel }
- suggestion_list: { type: "suggestion_list", items: [{ title, subtitle, action: { type: "navigate", screen, params } | null }] }
- inline_chart: { type: "inline_chart", chartType: "bar"|"progress"|"stat_row", title, data: [{ label, value, target?, hit? }], summary? }
- commitment_card: { type: "commitment_card", title, followUpText, followUpDate: "YYYY-MM-DD" }
- quick_replies: { type: "quick_replies", options: [{ label, message }] }
- form: { type: "form", title?, fields: [{ kind: "choice"|"multi_choice", label, options: ["...", "..."] } | { kind: "number", label, min, max, step, value, unit? }], submitLabel? } (1-4 fields; choice 2-6 options, multi_choice 2-8; value is where the number starts)
- recipe_card: { type: "recipe_card", recipe: { title, calories, protein, prepTime, imageUrl, recipeId, source: "community"|"generated" } }
- meal_plan_card: { type: "meal_plan_card", title, days: [{ label, meals: [{ type, title, calories, protein }], totals: { calories, protein } }] }

Rules:
- Include blocks only when they add value — don't force a fence into every response
- When you DO emit a coach_blocks fence, it must contain a quick_replies block with 2-3 contextual follow-up options, unless it contains a form; include other block types only when they add value
- When you need two or more details from the user before you can help, or one that is a number, ask with one form block instead of listing questions in prose: choice for pick-one, multi_choice for pick-any, number for an amount. The answers arrive as the user's next message. A form only asks: it saves nothing, so never say a form saved or changed anything
- Place the coach_blocks fence after your text response
- For recipe suggestions, use search_recipes tool first to get real recipe data
- Never put a recipe image or link in your prose reply (no ![]() markdown images, no [text](url) links). Refer to a recipe by its name.
- Use a recipe_card only when you have real calories, protein and prep time for that recipe from a tool result — search_recipes does not return calories or protein, so never estimate them to fill a card; name the recipe in prose instead. When you do use a recipe_card, put its image URL in the imageUrl field.
- For nutrition data, use lookup_nutrition tool first for accuracy
- If the user says they are allergic to peanuts, tree nuts, milk, eggs, wheat, soy, fish, shellfish or sesame and it is not already in their allergies, avoid it in this reply and add one action_card whose action is { "type": "add_allergy", "allergen": "<peanuts|tree_nuts|milk|eggs|wheat|soy|fish|shellfish|sesame>" }, titled like "Add shellfish to your allergies". Never guess the allergy's severity; the user picks it. For any other allergy, avoid it in this conversation and do not say it has been saved

Example response (match this format exactly — prose first, then the fence):
You're at 1,400 of 2,000 cal with 60g protein still to go — dinner has room for something substantial.
\`\`\`coach_blocks
[{"type":"quick_replies","options":[{"label":"Dinner ideas","message":"Suggest a dinner that fits my remaining macros"},{"label":"Show my progress","message":"How is my day looking so far?"}]}]
\`\`\`
`.trim();

const SEARCH_RECIPES_RULE =
  "- For recipe suggestions, use search_recipes tool first to get real recipe data";
const RECIPE_CARD_RULE =
  "- Use a recipe_card only when you have real calories, protein and prep time for that recipe from a tool result — search_recipes does not return calories or protein, so never estimate them to fill a card; name the recipe in prose instead. When you do use a recipe_card, put its image URL in the imageUrl field.";
const FINDER_RECIPE_RULE =
  '- Recipe requests are answered by the app\'s recipe finder, not by you. If the user wants a recipe, tell them to ask for one directly (for example "find me a chicken dinner recipe") and do not search for or invent recipes yourself';
const OFFER_RECIPE_RULE =
  "- When the user wants a recipe or cooking instructions for a dish, call the offer_recipe tool with no other text; the app's recipe finder makes the recipe. If you cannot name a concrete dish, ask which dish they mean. Meal ideas and suggestions are answered by you in plain text. Do not search for or invent recipes yourself";
const FINDER_RECIPE_CARD_RULE =
  "- Never emit a recipe_card: you have no tool that returns real recipe data";

/**
 * Write-card mode (spec 2026-11-09): the three write tools show their own
 * card, so the model must not ALSO emit the old navigate-style action cards.
 */
const WRITE_CARDS_RULES = [
  "- Never emit log_food, add_meal_plan or add_grocery_list action cards; the write tools (log_food_item, add_to_grocery_list, add_to_meal_plan) show their own card for the user to check and save. Nothing is saved until the user taps it, so never say something was logged or added.",
  "- To plan meals, find recipes with find_plan_recipes or get_my_recipes first and pass their ids; offer up to 3 alternatives per row.",
  "- When the user asks for meals and their grocery or shopping list in one request, do it as one job: find the recipes, then call add_to_meal_plan once with withGroceryList: true, and never also call add_to_grocery_list in that turn. A turn shows one card, and that card saves both.",
  "- Food can be logged for today or yesterday only; for an earlier day, tell the user to use Quick Log on the Home screen.",
].join("\n");

/**
 * Coach roadmap T2: an app that shows a food log applied at once. The rule
 * above still holds for every other card; this one names the exception.
 */
const TAP_TO_SAVE =
  "Nothing is saved until the user taps it, so never say something was logged or added.";
const TAP_TO_SAVE_EXCEPT =
  "Nothing is saved until the user taps it, so never say something was logged or added, except a small food log as the next rule says.";
const QUICK_LOG_RULE =
  "- A small food log can be logged at once: when the log_food_item result says it is already logged, say it was logged and that the user can tap Undo on its card. To change a food that is already logged, ask the user to tap Undo on its card first or to edit it in their log; never call log_food_item again for it, which would log it twice.";
const INLINE_CHART_LINE =
  '- inline_chart: { type: "inline_chart", chartType: "bar"|"progress"|"stat_row", title, data: [{ label, value, target?, hit? }], summary? }';
/** Coach roadmap T3: a card that names the day and stays current. */
const DAY_PROGRESS_LINE =
  '- day_progress: { type: "day_progress", day: "today"|"yesterday" } (the app fills in that day\'s calories, protein, carbs and fat against the goals, and keeps them up to date)';
const DAY_PROGRESS_RULE =
  "- For how today or yesterday is going against the goals, use one day_progress block, not an inline_chart: its numbers stay current. Keep inline_chart for anything else, such as a week or a trend";
const COMMITMENT_CARD_LINE =
  '- commitment_card: { type: "commitment_card", title, followUpText, followUpDate: "YYYY-MM-DD" }';
const NOTES_PAUSED_RULE =
  "- Coach's notes are off for this user, so you cannot save a commitment or check in later. Never say you noted, saved or will follow up on something; you can still encourage the plan in this reply";

/** Drops commitment cards: for a reply made while Coach's notes are paused. */
export function dropCommitmentCards(blocks: CoachBlock[]): CoachBlock[] {
  return blocks.filter((b) => b.type !== "commitment_card");
}

/**
 * BLOCKS_SYSTEM_PROMPT, minus search_recipes when the finder is on. `offer`
 * swaps the finder rule for the offer_recipe tool rule. `notesPaused` takes
 * the commitment card away.
 */
export function getBlocksSystemPrompt(
  finderEnabled: boolean,
  opts: {
    offer?: boolean;
    writeCards?: boolean;
    notesPaused?: boolean;
    /** The app shows a small food log applied at once (T2). */
    quickLog?: boolean;
    /** The app can draw a day_progress card (T3). */
    dayProgress?: boolean;
  } = {},
): string {
  const withCards = withDayProgress(
    blocksPromptFor(finderEnabled, opts),
    !!opts.dayProgress,
  );
  if (!opts.notesPaused) return withCards;
  // Coach's notes are paused (no health consent on record): a commitment card
  // offers a check-in that nothing would save. Not offered, and said so.
  return withCards
    .replace(`${COMMITMENT_CARD_LINE}\n`, "")
    .replace(
      "\n\nExample response",
      `\n${NOTES_PAUSED_RULE}\n\nExample response`,
    );
}

/**
 * The turn's blocks prompt with the offer_recipe rule in place of the
 * finder's. For a turn given the offer tool after its prompt was built: the
 * rules the app asked for (write cards, quick log, day progress) are kept,
 * where rebuilding the prompt would lose the ones it was not told about.
 */
export function withOfferRecipeRule(blocksPrompt: string): string {
  return blocksPrompt.replace(FINDER_RECIPE_RULE, OFFER_RECIPE_RULE);
}

/** Offers the day_progress card next to inline_chart, with its rule. */
function withDayProgress(prompt: string, on: boolean): string {
  if (!on) return prompt;
  return prompt
    .replace(INLINE_CHART_LINE, `${INLINE_CHART_LINE}\n${DAY_PROGRESS_LINE}`)
    .replace(
      "\n\nExample response",
      `\n${DAY_PROGRESS_RULE}\n\nExample response`,
    );
}

function blocksPromptFor(
  finderEnabled: boolean,
  opts: { offer?: boolean; writeCards?: boolean; quickLog?: boolean },
): string {
  const base = !finderEnabled
    ? BLOCKS_SYSTEM_PROMPT
    : // The offer rule REPLACES the finder rule (never appended).
      BLOCKS_SYSTEM_PROMPT.replace(
        SEARCH_RECIPES_RULE,
        opts.offer ? OFFER_RECIPE_RULE : FINDER_RECIPE_RULE,
      ).replace(RECIPE_CARD_RULE, FINDER_RECIPE_CARD_RULE);
  if (!opts.writeCards) return base;
  // Appended to the Rules list (before the example), never replacing a rule.
  // With quick log, the "never say logged" sentence names its exception
  // rather than contradict the rule after it.
  const rules = opts.quickLog
    ? `${WRITE_CARDS_RULES.replace(TAP_TO_SAVE, TAP_TO_SAVE_EXCEPT)}\n${QUICK_LOG_RULE}`
    : WRITE_CARDS_RULES;
  return base.replace("\n\nExample response", `\n${rules}\n\nExample response`);
}
