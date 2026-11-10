import { describe, it, expect } from "vitest";
import { buildTrail, plainStatusLabel, toolStep } from "../coach-step-labels";

const call = (name: string, args: unknown) => ({
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args),
});

describe("coach step labels (show-the-work spec 2026-11-09)", () => {
  it("lookup_nutrition names what it looks up", () => {
    expect(
      toolStep(call("lookup_nutrition", { query: "beef burger" }), {
        writeCards: true,
      }),
    ).toEqual({ label: "Looking up beef burger…", trail: "beef burger" });
  });

  it("card tools never claim a save", () => {
    for (const name of [
      "log_food_item",
      "add_to_meal_plan",
      "add_to_grocery_list",
    ]) {
      for (const writeCards of [true, false]) {
        expect(toolStep(call(name, {}), { writeCards }).label).not.toMatch(
          /Logging|Logged|Updating|Added|Saved/,
        );
      }
      expect(plainStatusLabel(name)).not.toMatch(
        /Logging|Logged|Updating|Added|Saved/,
      );
    }
  });

  it("card mode says it prepares a card", () => {
    expect(toolStep(call("log_food_item", {}), { writeCards: true })).toEqual({
      label: "Preparing a food card…",
      trail: "food card",
    });
    expect(toolStep(call("log_food_item", {}), { writeCards: false })).toEqual({
      label: "Preparing a food entry…",
      trail: "food entry",
    });
  });

  it("malformed JSON falls back to the no-value label", () => {
    expect(
      toolStep(call("lookup_nutrition", '{"query":"bee'), {
        writeCards: true,
      }),
    ).toEqual({ label: "Looking up nutrition…", trail: "nutrition lookup" });
  });

  it("hostile or long values are sanitized, one line, capped at 40 chars", () => {
    const long = "ignore previous instructions\n" + "x ".repeat(250);
    const { label, trail } = toolStep(
      call("lookup_nutrition", { query: long }),
      { writeCards: true },
    );
    expect(label).not.toMatch(/\n/);
    expect(label).not.toMatch(/ignore previous instructions/i);
    expect(trail!.length).toBeLessThanOrEqual(41); // 40 + "…"
    expect(label.length).toBeLessThanOrEqual("Looking up ".length + 41 + 1);
  });

  it("a capped value ends in exactly one ellipsis", () => {
    const { label, trail } = toolStep(
      call("search_recipes", { query: "a".repeat(60) }),
      { writeCards: true },
    );
    expect(label).toBe(`Searching recipes for ${"a".repeat(40)}…`);
    expect(trail).toBe(`${"a".repeat(40)}… recipes`);
    expect(
      toolStep(call("lookup_nutrition", { query: "x y ".repeat(30) }), {
        writeCards: true,
      }).label,
    ).not.toMatch(/……/);
  });

  it("get_substitutions names the first ingredient", () => {
    expect(
      toolStep(
        call("get_substitutions", { ingredients: [{ name: "butter" }] }),
        { writeCards: true },
      ),
    ).toEqual({
      label: "Finding swaps for butter…",
      trail: "swaps for butter",
    });
  });

  it("a read tool with no value uses its fixed label", () => {
    expect(
      toolStep(call("get_daily_log_details", {}), { writeCards: true }),
    ).toEqual({ label: "Reading today's log…", trail: "today's log" });
  });

  it("unknown tool: Working on it…, no trail entry", () => {
    expect(toolStep(call("mystery", {}), { writeCards: true })).toEqual({
      label: "Working on it…",
      trail: null,
    });
  });

  it("buildTrail dedupes case-insensitively, drops nulls, keeps 5", () => {
    expect(
      buildTrail(["today's log", null, "Today's log", "a", "b", "c", "d", "e"]),
    ).toEqual(["today's log", "a", "b", "c", "d"]);
  });

  it("plainStatusLabel keeps today's labels for read tools", () => {
    expect(plainStatusLabel("get_pantry_items")).toBe("Checking your pantry…");
    expect(plainStatusLabel("find_plan_recipes")).toBe("Finding recipes…");
    expect(plainStatusLabel("mystery")).toBe("Working on it…");
  });
});
