#!/usr/bin/env npx tsx
/**
 * Manually promote and enrich a recipe to curated status, bypassing the
 * popularity threshold. Run with:
 *   npx tsx scripts/canonicalize-recipe.ts <id>
 *   npx tsx scripts/canonicalize-recipe.ts --search "chicken tikka"
 *   npx tsx scripts/canonicalize-recipe.ts --top 5
 */
import { db } from "../server/db";
import { communityRecipes } from "../shared/schema";
import { ilike, desc } from "drizzle-orm";
import {
  markCanonical,
  getRecipeById,
} from "../server/storage/canonical-recipes";
import { enrichRecipe } from "../server/services/canonical-enrichment";

async function canonicalizeById(id: number) {
  const recipe = await getRecipeById(id);
  if (!recipe) {
    console.error(`Recipe ${id} not found`);
    process.exit(1);
  }
  console.log(`\nCanonicalizing: "${recipe.title}" (id=${recipe.id})`);
  console.log(`  Current image: ${recipe.imageUrl ?? "(none)"}`);
  console.log(`  Instructions: ${recipe.instructions?.length ?? 0} steps`);
  console.log(`  Is canonical: ${recipe.isCanonical}`);

  if (!recipe.isCanonical) {
    await markCanonical(recipe.id);
    console.log("  ✓ Marked canonical");
  }

  console.log("  Running enrichment pipeline...");
  await enrichRecipe(recipe.id);
  const updated = await getRecipeById(recipe.id);
  console.log(`  ✓ Canonical images: ${updated?.canonicalImages?.length ?? 0}`);
  console.log(
    `  ✓ Instruction details: ${updated?.instructionDetails?.filter(Boolean).length ?? 0}/${updated?.instructions?.length ?? 0} steps`,
  );
  console.log(`  ✓ Tools required: ${updated?.toolsRequired?.length ?? 0}`);
  console.log(`  ✓ Chef tips: ${updated?.chefTips?.length ?? 0}`);
  console.log(`  ✓ Cuisine origin: ${updated?.cuisineOrigin ?? "(none)"}`);
  console.log(`  Done: ${recipe.title}\n`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--search" && args[1]) {
    const q = `%${args[1]}%`;
    const [recipe] = await db
      .select()
      .from(communityRecipes)
      .where(ilike(communityRecipes.title, q))
      .limit(1);
    if (!recipe) {
      console.error(`No recipe matching "${args[1]}"`);
      process.exit(1);
    }
    await canonicalizeById(recipe.id);
  } else if (args[0] === "--top" && args[1]) {
    const n = parseInt(args[1], 10);
    const recipes = await db
      .select()
      .from(communityRecipes)
      .orderBy(desc(communityRecipes.popularityScore))
      .limit(n);
    console.log(`Canonicalizing top ${n} recipes by popularity score`);
    for (const r of recipes) {
      await canonicalizeById(r.id);
    }
  } else if (args[0] && /^\d+$/.test(args[0])) {
    await canonicalizeById(parseInt(args[0], 10));
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/canonicalize-recipe.ts <id>");
    console.log(
      '  npx tsx scripts/canonicalize-recipe.ts --search "chicken tikka"',
    );
    console.log("  npx tsx scripts/canonicalize-recipe.ts --top 5");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
