/**
 * Guard test: only the meal-plan route and the meal-plan storage module may
 * mention `includeProfileMeals`.
 *
 * `getMealPlanItems` hides a family profile's own meals unless a caller passes
 * `{ includeProfileMeals: true }`, and only `GET /api/meal-plan` does. A second
 * opt-in anywhere else (a coach tool, a prompt builder, a new route) could put
 * a family member's meal in front of an AI provider, so any new mention fails
 * here and needs a deliberate decision.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SERVER_DIR = join(process.cwd(), "server");
const NEEDLE = "includeProfileMeals";
const ALLOWED = new Set([
  "server/routes/meal-plan.ts",
  "server/storage/meal-plan-items.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "__tests__") return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return name.endsWith(".ts") ? [p] : [];
  });
}

function filesMentioningNeedle(): string[] {
  return walk(SERVER_DIR)
    .filter((f) => readFileSync(f, "utf8").includes(NEEDLE))
    .map((f) => relative(process.cwd(), f).split(sep).join("/"))
    .sort();
}

describe("includeProfileMeals guard", () => {
  it("finds the opt-in in the meal-plan route (positive control)", () => {
    expect(walk(SERVER_DIR).length).toBeGreaterThan(50);
    expect(filesMentioningNeedle()).toContain("server/routes/meal-plan.ts");
  });

  it("appears in no other server file", () => {
    const offenders = filesMentioningNeedle().filter((f) => !ALLOWED.has(f));
    expect(offenders).toEqual([]);
  });
});
