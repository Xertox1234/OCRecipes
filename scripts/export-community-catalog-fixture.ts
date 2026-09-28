// scripts/export-community-catalog-fixture.ts
/**
 * Writes a fixture copy of the PUBLIC community catalog for the recipe-finder
 * close-match gold set (spec §7). Public recipe content only: no author ids,
 * no image URLs.
 *
 *   NODE_ENV=development DATABASE_URL=postgresql://localhost/nutricam npx tsx scripts/export-community-catalog-fixture.ts
 *
 * If the dev catalog is not representative of production, ask the user to run
 * the same command against production (prod reads are run by the user).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { storage } from "../server/storage";

const OUT = path.resolve(
  process.cwd(),
  "server/services/recipe-finder/__tests__/fixtures/community-catalog.json",
);

async function main(): Promise<void> {
  const rows = await storage.getAllPublicCommunityRecipes();
  const fixture = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    ingredients: (r.ingredients ?? []).map((i) => ({
      name: i.name,
      quantity: i.quantity ?? "",
      unit: i.unit ?? "",
    })),
    dietTags: r.dietTags ?? [],
    mealTypes: r.mealTypes ?? [],
    allergens: r.allergens ?? null,
    difficulty: r.difficulty ?? null,
    servings: r.servings ?? null,
    caloriesPerServing: r.caloriesPerServing ?? null,
    proteinPerServing: r.proteinPerServing ?? null,
    carbsPerServing: r.carbsPerServing ?? null,
    fatPerServing: r.fatPerServing ?? null,
    imageUrl: null,
    isCanonical: r.isCanonical ?? false,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
  }));
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`wrote ${fixture.length} public community recipes to ${OUT}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
