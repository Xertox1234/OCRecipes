import { sanitizeUserInput } from "../lib/ai-safety";

/**
 * What Coach shows while it works (show-the-work spec 2026-11-09).
 *
 * - `plainStatusLabel` feeds the existing `{status}` SSE event, which runtime
 *   5.1.0 phones read with no pacing queue, so it stays generic.
 * - `toolStep` builds the specific label for the new `{step}` event and the
 *   noun that goes in the "Checked:" trail, from the tool's own arguments.
 *
 * Labels never claim a save: the write tools only draft a card (write-card
 * mode) or return a proposal, so they say "Preparing…".
 */

const PLAIN_LABELS: Record<string, string> = {
  lookup_nutrition: "Looking up nutrition…",
  search_recipes: "Searching recipes…",
  find_plan_recipes: "Finding recipes…",
  get_my_recipes: "Checking your recipes…",
  get_daily_log_details: "Checking today's log…",
  log_food_item: "Preparing a food entry…",
  get_pantry_items: "Checking your pantry…",
  get_meal_plan: "Checking your meal plan…",
  add_to_meal_plan: "Planning your meals…",
  add_to_grocery_list: "Preparing grocery items…",
  get_substitutions: "Finding substitutes…",
};

const FALLBACK_LABEL = "Working on it…";
const VALUE_CAP = 40;
const TRAIL_MAX = 5;

export function plainStatusLabel(toolName: string): string {
  return PLAIN_LABELS[toolName] ?? FALLBACK_LABEL;
}

/** A user-derived value made safe and short enough for one status line. */
function capValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = sanitizeUserInput(raw).replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length <= VALUE_CAP) return clean;
  const cut = clean.slice(0, VALUE_CAP);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function firstIngredientName(args: Record<string, unknown>): unknown {
  const list = args.ingredients;
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const first: unknown = list[0];
  return typeof first === "object" && first !== null
    ? (first as Record<string, unknown>).name
    : undefined;
}

export interface ToolStep {
  label: string;
  trail: string | null;
}

export function toolStep(
  call: { name: string; arguments: string },
  opts: { writeCards: boolean },
): ToolStep {
  const args = parseArgs(call.arguments);
  const card = opts.writeCards;
  switch (call.name) {
    case "lookup_nutrition": {
      const v = capValue(args.query);
      return v
        ? { label: `Looking up ${v}…`, trail: v }
        : { label: "Looking up nutrition…", trail: "nutrition lookup" };
    }
    case "search_recipes": {
      const v = capValue(args.query);
      return v
        ? { label: `Searching recipes for ${v}…`, trail: `${v} recipes` }
        : { label: "Searching recipes…", trail: "recipes" };
    }
    case "find_plan_recipes": {
      const v = capValue(args.query);
      return v
        ? { label: `Finding ${v} recipes…`, trail: `${v} recipes` }
        : { label: "Finding recipes…", trail: "recipes" };
    }
    case "get_my_recipes": {
      const v = capValue(args.query);
      return {
        label: v ? `Checking your recipes for ${v}…` : "Checking your recipes…",
        trail: "your recipes",
      };
    }
    case "get_daily_log_details": {
      const v = capValue(args.date);
      return v
        ? { label: `Reading your log for ${v}…`, trail: `log for ${v}` }
        : { label: "Reading today's log…", trail: "today's log" };
    }
    case "get_pantry_items":
      return { label: "Checking your pantry…", trail: "your pantry" };
    case "get_meal_plan":
      return { label: "Checking your meal plan…", trail: "your meal plan" };
    case "get_substitutions": {
      const v = capValue(firstIngredientName(args));
      return v
        ? { label: `Finding swaps for ${v}…`, trail: `swaps for ${v}` }
        : { label: "Finding substitutes…", trail: "substitutes" };
    }
    case "log_food_item":
      return card
        ? { label: "Preparing a food card…", trail: "food card" }
        : { label: "Preparing a food entry…", trail: "food entry" };
    case "add_to_meal_plan":
      return card
        ? { label: "Preparing a meal plan card…", trail: "meal plan card" }
        : { label: "Preparing a meal plan…", trail: "meal plan" };
    case "add_to_grocery_list":
      return card
        ? { label: "Preparing a grocery card…", trail: "grocery card" }
        : { label: "Preparing grocery items…", trail: "grocery items" };
    default:
      return { label: FALLBACK_LABEL, trail: null };
  }
}

/** The "Checked:" trail: first-seen order, no repeats, at most five. */
export function buildTrail(entries: (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length === TRAIL_MAX) break;
  }
  return out;
}
