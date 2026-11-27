/**
 * Coach Tools Service
 *
 * The nutrition coach's OpenAI function-calling tools, as a registry. Each
 * tool is ONE entry (definition, args schema, availability, handler) in a
 * domain file under ./coach-tools/; this module orders them and dispatches.
 * Because `getToolDefinitions` and `executeToolCall` both read the entry's
 * `available`, "offered to the model" and "executable" are one rule.
 *
 * Tools available to the coach AI:
 *   1. lookup_nutrition      — look up macros for any food
 *   2. search_recipes        — search OCRecipes community recipes
 *   3. get_daily_log_details — fetch today's food log + totals
 *   4. log_food_item         — add a food item to today's log
 *   5. get_pantry_items      — list pantry items (optionally expiring soon)
 *   6. get_meal_plan         — get meal plan for a date range
 *   7. add_to_meal_plan      — schedule a recipe/food on the meal plan
 *   8. add_to_grocery_list   — create a new grocery list with items
 *   9. get_substitutions     — suggest ingredient swaps
 *  10. get_grocery_lists     — recent grocery lists with the items still to buy
 *
 * With write cards, also: get_intake_history (several days of totals, for
 * trend charts), get_my_recipes, find_plan_recipes, get_recent_scans
 * (the latest scans, for the compare card), get_weekly_reports (for the
 * weekly report card), and the card-gated write tools.
 */

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { createHash } from "crypto";
import { logger } from "../lib/logger";
import type { UserProfile } from "@shared/schema";
import { GOALS_TOOLS } from "./coach-tools/goals";
import { GROCERY_TOOLS } from "./coach-tools/grocery";
import { INTAKE_HISTORY_TOOLS } from "./coach-tools/intake-history";
import { NUTRITION_TOOLS } from "./coach-tools/nutrition";
import { PANTRY_TOOLS } from "./coach-tools/pantry";
import { PLAN_TOOLS } from "./coach-tools/plan";
import { RECIPE_TOOLS } from "./coach-tools/recipes";
import { FAMILY_TOOLS } from "./coach-tools/family";
import { REMINDER_TOOLS } from "./coach-tools/reminders";
import { SCAN_TOOLS } from "./coach-tools/scans";
import { WEEKLY_REPORT_TOOLS } from "./coach-tools/weekly-reports";
import {
  invalidArgs,
  type CoachToolEntry,
  type ExecuteToolOptions,
  type ToolErrorResult,
} from "./coach-tools/types";

export { serviceUnavailable } from "./coach-tools/types";
export type { ExecuteToolOptions, ToolErrorResult } from "./coach-tools/types";

/** Maximum number of tool calls the coach may make in a single response turn.
 *  A week's review alone takes 7 (get_daily_log_details reads one day), so the
 *  budget leaves room for a few more around it. */
export const MAX_TOOL_CALLS_PER_RESPONSE = 10;

function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

/**
 * Registry order is the order the model is shown the tools: the original ten
 * first, then the write-card-only tools. Domain files hold the entries; this
 * list only sequences them.
 */
const ALL_TOOLS: CoachToolEntry[] = [
  ...NUTRITION_TOOLS,
  ...INTAKE_HISTORY_TOOLS,
  ...RECIPE_TOOLS,
  ...PANTRY_TOOLS,
  ...GROCERY_TOOLS,
  ...PLAN_TOOLS,
  ...GOALS_TOOLS,
  ...SCAN_TOOLS,
  ...WEEKLY_REPORT_TOOLS,
  ...REMINDER_TOOLS,
  ...FAMILY_TOOLS,
];

const TOOL_ORDER = [
  "lookup_nutrition",
  "search_recipes",
  "get_daily_log_details",
  "log_food_item",
  "get_pantry_items",
  "get_grocery_lists",
  "get_meal_plan",
  "add_to_meal_plan",
  "add_to_grocery_list",
  "get_substitutions",
  "get_my_recipes",
  "find_plan_recipes",
  "get_recent_scans",
  "get_weekly_reports",
  "get_intake_history",
  "update_pantry",
  "set_nutrition_goals",
  "set_reminders",
  "add_family_member",
] as const;

const TOOL_REGISTRY: CoachToolEntry[] = TOOL_ORDER.map((name) => {
  const entry = ALL_TOOLS.find((t) => t.name === name);
  if (!entry) throw new Error(`Coach tool not registered: ${name}`);
  return entry;
});

/**
 * The model's tools: every registry entry available for this turn.
 * `writeCards` (the app sent `writeCards: true` — it can show write cards,
 * spec 2026-11-09) swaps the three write tools for their card-building forms
 * and adds the two recipe-id tools a plan card needs; `pantryCard` adds
 * update_pantry; `goalsCard` adds set_nutrition_goals; `remindersCard` adds
 * set_reminders; `familyCard` adds add_family_member. Without them the list is exactly the original ten, so an
 * older app is unaffected.
 */
export function getToolDefinitions(
  opts: {
    writeCards?: boolean;
    pantryCard?: boolean;
    goalsCard?: boolean;
    remindersCard?: boolean;
    familyCard?: boolean;
  } = {},
): ChatCompletionTool[] {
  return TOOL_REGISTRY.filter((t) => t.available(opts)).map((t) =>
    t.definition(opts),
  );
}

/** Loose type for tool arguments — callers pass raw JSON-decoded objects. */
type ToolArgs = Record<string, unknown>;

/**
 * Dispatches a tool call: find the entry, check it is available, validate its
 * args, run it.
 *
 * @param toolName - The function name from the OpenAI tool call
 * @param args     - Parsed JSON arguments from the tool call
 * @param userId   - The authenticated user's ID
 * @returns A plain serialisable object representing the tool result
 * @throws Error if the tool is not registered or not available this turn (a
 *         model can call a tool name it was never offered)
 */
export async function executeToolCall(
  toolName: string,
  args: ToolArgs,
  userId: string,
  /**
   * Unused (search_recipes no longer needs the profile). Deliberately kept:
   * removing it shifts every later positional arg of this function and of
   * generateCoachProResponse, which tests pin by index (mock.calls[0][5]/[7]).
   */
  _preloadedProfile?: UserProfile | null,
  /** IANA timezone of the requesting user — day-buckets "today" tool data. */
  tz: string = "UTC",
  /** Write-card mode (spec 2026-11-09). New trailing param — see above. */
  opts: ExecuteToolOptions = {},
): Promise<ToolErrorResult | object> {
  logger.debug(
    { toolName, userIdHash: hashUserId(userId) },
    "Executing coach tool call",
  );

  const entry = TOOL_REGISTRY.find((t) => t.name === toolName);
  if (!entry || !entry.available(opts)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  const parsed = entry.argsSchema(opts).safeParse(args);
  if (!parsed.success) {
    return invalidArgs(toolName, parsed.error.message);
  }
  return entry.run(parsed.data, { userId, tz, opts });
}
