import { describe, it, expect, vi } from "vitest";

import { executeToolCall, getToolDefinitions } from "../coach-tools";

vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../nutrition-lookup", () => ({ lookupNutrition: vi.fn() }));
vi.mock("../recipe-finder/find-community", () => ({ findCommunity: vi.fn() }));
vi.mock("../ingredient-substitution", () => ({ getSubstitutions: vi.fn() }));
vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const OPTION_SETS = [
  {},
  { writeCards: true },
  { pantryCard: true },
  { writeCards: true, pantryCard: true },
  { goalsCard: true },
  { writeCards: true, goalsCard: true },
  { writeCards: true, pantryCard: true, goalsCard: true },
];

const ALL_TOOL_NAMES = [
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
  "update_pantry",
  "set_nutrition_goals",
];

function offeredNames(opts: {
  writeCards?: boolean;
  pantryCard?: boolean;
  goalsCard?: boolean;
}) {
  return getToolDefinitions(opts).map((t) =>
    "function" in t ? t.function.name : "",
  );
}

describe("coach tool registry: offered and executable are one rule", () => {
  it.each(OPTION_SETS)(
    "a tool is executable exactly when it is offered (%j)",
    async (opts) => {
      const offered = new Set(offeredNames(opts));
      for (const name of ALL_TOOL_NAMES) {
        // An unavailable tool throws "Unknown tool" before any arg parsing;
        // an available one never does (bad args come back as a result).
        const outcome = await executeToolCall(
          name,
          { __invalid__: true },
          "user-1",
          null,
          "UTC",
          opts,
        ).then(
          () => "ran",
          (err: Error) => err.message,
        );
        if (offered.has(name)) {
          expect(outcome, name).not.toBe(`Unknown tool: ${name}`);
        } else {
          expect(outcome, name).toBe(`Unknown tool: ${name}`);
        }
      }
    },
  );

  it("offers the original ten without write cards, in a stable order", () => {
    expect(offeredNames({})).toEqual(ALL_TOOL_NAMES.slice(0, 10));
  });

  it("adds the recipe-id tools and get_recent_scans with write cards, and update_pantry only with the pantry card", () => {
    expect(offeredNames({ writeCards: true })).toEqual(
      ALL_TOOL_NAMES.slice(0, 13),
    );
    expect(offeredNames({ writeCards: true, pantryCard: true })).toEqual(
      ALL_TOOL_NAMES.slice(0, 14),
    );
    expect(
      offeredNames({ writeCards: true, pantryCard: true, goalsCard: true }),
    ).toEqual(ALL_TOOL_NAMES);
    expect(offeredNames({ writeCards: true, goalsCard: true })).toEqual([
      ...ALL_TOOL_NAMES.slice(0, 13),
      "set_nutrition_goals",
    ]);
    expect(offeredNames({ goalsCard: true })).toEqual(
      ALL_TOOL_NAMES.slice(0, 10),
    );
    // pantryCard alone never enables write-card-only tools.
    expect(offeredNames({ pantryCard: true })).toEqual(
      ALL_TOOL_NAMES.slice(0, 10),
    );
  });

  it("rejects an unregistered tool name", async () => {
    await expect(executeToolCall("nope", {}, "user-1")).rejects.toThrow(
      "Unknown tool: nope",
    );
  });
});
