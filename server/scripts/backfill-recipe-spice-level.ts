/* eslint-disable no-console */
/**
 * Backfill: asks the AI for a spice level (mild / medium / hot) on existing
 * community + meal-plan recipes whose `spice_level` is still NULL.
 *
 * A SIBLING of backfill-recipe-allergens.ts on purpose: that script is
 * deterministic and rewrites every row, this one spends AI calls and must
 * touch ONLY `spice_level`. It never writes `allergens` or `diet_conflicts`.
 *
 * - Only rows with `spice_level IS NULL` are asked, and every UPDATE repeats
 *   that condition, so an answered row is never re-asked or overwritten.
 *   A row the AI answers null for (no meaningful heat) stays null and WILL be
 *   asked again on the next run — null cannot tell "no heat" from "not asked".
 * - Replies are validated with the shared `spiceLevelSchema`; anything missing
 *   or invalid leaves the row null. A level is never guessed.
 * - It prints how many rows it would ask about BEFORE any AI call.
 *   DRY_RUN=1 prints that and stops — zero AI calls, zero writes.
 *
 * Needs migrations/0029_recipe_spice_level.sql applied first. After a real run
 * on prod, restart the server (the search index is built at boot).
 *
 * Usage:
 *   DRY_RUN=1 npx tsx server/scripts/backfill-recipe-spice-level.ts
 *   npx tsx server/scripts/backfill-recipe-spice-level.ts
 */
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { aiChat } from "../lib/ai-client";
import { db, pool } from "../db";
import { communityRecipes, mealPlanRecipes } from "@shared/schema";
import type { SpiceLevel } from "@shared/schemas/recipe-finder";
import { storage } from "../storage";
import {
  SPICE_BATCH_SIZE,
  SPICE_SYSTEM_PROMPT,
  buildSpiceUserMessage,
  chunk,
  parseSpiceReply,
  type SpiceRow,
} from "./backfill-recipe-spice-level-utils";

const DRY_RUN = process.env.DRY_RUN === "1";

async function askSpiceLevels(
  rows: SpiceRow[],
): Promise<Map<number, SpiceLevel>> {
  try {
    const response = await aiChat(
      "script-backfill-spice",
      {
        temperature: 0,
        max_completion_tokens: 400,
        messages: [
          { role: "system", content: SPICE_SYSTEM_PROMPT },
          { role: "user", content: buildSpiceUserMessage(rows) },
        ],
        response_format: { type: "json_object" },
      },
      { timeout: 30_000 },
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return new Map();
    return parseSpiceReply(
      content,
      rows.map((r) => r.id),
    );
  } catch (err) {
    console.error("  Spice batch failed (rows stay null):", err);
    return new Map();
  }
}

async function loadCommunityRows(): Promise<SpiceRow[]> {
  const rows = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      ingredients: communityRecipes.ingredients,
    })
    .from(communityRecipes)
    .where(isNull(communityRecipes.spiceLevel));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    ingredients: (r.ingredients ?? []).map((i) => i.name),
  }));
}

async function loadMealPlanRows(): Promise<SpiceRow[]> {
  const rows = await db
    .select({ id: mealPlanRecipes.id, title: mealPlanRecipes.title })
    .from(mealPlanRecipes)
    .where(isNull(mealPlanRecipes.spiceLevel));
  const ingredientMap = await storage.getAllRecipeIngredients();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    ingredients: (ingredientMap.get(r.id) ?? []).map((i) => i.name),
  }));
}

async function fill(
  kind: "community" | "meal-plan",
  rows: SpiceRow[],
): Promise<{ filled: number; left: number }> {
  let filled = 0;
  for (const batch of chunk(rows, SPICE_BATCH_SIZE)) {
    const answers = await askSpiceLevels(batch);
    for (const [id, level] of answers) {
      // `spice_level IS NULL` again: never overwrite a row answered meanwhile.
      if (kind === "community") {
        await db
          .update(communityRecipes)
          .set({ spiceLevel: level })
          .where(
            and(
              eq(communityRecipes.id, id),
              isNull(communityRecipes.spiceLevel),
            ),
          );
      } else {
        await db
          .update(mealPlanRecipes)
          .set({ spiceLevel: level })
          .where(
            and(eq(mealPlanRecipes.id, id), isNull(mealPlanRecipes.spiceLevel)),
          );
      }
      filled++;
    }
    console.log(
      `  ${kind}: batch of ${batch.length} -> ${answers.size} level(s) set`,
    );
  }
  return { filled, left: rows.length - filled };
}

async function main() {
  console.log(
    `=== Backfill recipe spice level${DRY_RUN ? " (DRY RUN)" : ""} ===\n`,
  );
  const community = await loadCommunityRows();
  const mealPlan = await loadMealPlanRows();
  const total = community.length + mealPlan.length;
  const calls =
    Math.ceil(community.length / SPICE_BATCH_SIZE) +
    Math.ceil(mealPlan.length / SPICE_BATCH_SIZE);
  console.log(
    `Would ask the AI about ${community.length} community + ${mealPlan.length} meal-plan recipe(s) with no spice level (${total} rows, ~${calls} AI call(s)).`,
  );

  if (DRY_RUN || total === 0) {
    console.log(
      DRY_RUN ? "Dry run: no AI calls, no writes." : "Nothing to do.",
    );
    await pool.end();
    return;
  }

  const c = await fill("community", community);
  const m = await fill("meal-plan", mealPlan);
  console.log(
    `\n=== Done: ${c.filled + m.filled} level(s) set, ${c.left + m.left} left null (no heat / unsure / failed) ===`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
