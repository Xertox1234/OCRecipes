import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../../db";
import { communityRecipes } from "@shared/schema";
import { getTrendingSearchTerms } from "../community-recipes";
import { eq } from "drizzle-orm";

// Tests run against the local dev database, so this file must not touch rows
// it didn't create. Fixtures use terms unique to this run and scores far above
// any real recipe, so they rank first without a table-wide DELETE. Only this
// run's rows are deleted afterwards.
const RUN = `trending-test-${randomUUID()}`;
const term = (name: string) => `${RUN}-${name}`;

async function insertRecipe(over: Record<string, unknown>) {
  await db.insert(communityRecipes).values({
    normalizedProductName: RUN,
    title: "t",
    instructions: ["x"],
    isPublic: true,
    ...over,
  } as typeof communityRecipes.$inferInsert);
}

describe("getTrendingSearchTerms", () => {
  afterEach(async () => {
    await db
      .delete(communityRecipes)
      .where(eq(communityRecipes.normalizedProductName, RUN));
  });

  it("ranks diet-tag + cuisine terms by summed popularity, public only", async () => {
    await insertRecipe({
      dietTags: [term("vegan")],
      cuisineOrigin: term("Italian"),
      popularityScore: 100_000_000,
    });
    await insertRecipe({
      dietTags: [term("vegan"), term("high-protein")],
      popularityScore: 50_000_000,
    });
    // Private, with the highest score of all: it would rank first if the
    // public-only filter were dropped.
    await insertRecipe({
      dietTags: [term("keto")],
      popularityScore: 1_000_000_000,
      isPublic: false,
    });

    const terms = await getTrendingSearchTerms(3);
    expect(terms).toEqual([
      term("vegan"), // 150M total
      term("Italian"), // 100M
      term("high-protein"), // 50M
    ]);
  });
});
