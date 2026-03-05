/* eslint-disable no-console */
/**
 * One-time backfill: tags existing meal plan recipes with inferred mealTypes.
 *
 * Usage: npx tsx server/scripts/backfill-meal-types.ts
 */
import "dotenv/config";
import { backfillMealTypes } from "../services/meal-type-inference";
import { pool } from "../db";

async function main() {
  const updated = await backfillMealTypes();
  console.log(`Backfilled mealTypes on ${updated} recipe(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
