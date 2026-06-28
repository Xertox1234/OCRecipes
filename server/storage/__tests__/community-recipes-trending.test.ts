import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../db";
import { communityRecipes } from "@shared/schema";
import { getTrendingSearchTerms } from "../community-recipes";
import { sql } from "drizzle-orm";

async function insertRecipe(over: Record<string, unknown>) {
  await db.insert(communityRecipes).values({
    normalizedProductName: "t",
    title: "t",
    instructions: ["x"],
    isPublic: true,
    ...over,
  } as typeof communityRecipes.$inferInsert);
}

describe("getTrendingSearchTerms", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM community_recipes`);
  });

  it("ranks diet-tag + cuisine terms by summed popularity, public only", async () => {
    await insertRecipe({
      dietTags: ["vegan"],
      cuisineOrigin: "Italian",
      popularityScore: 100,
    });
    await insertRecipe({
      dietTags: ["vegan", "high-protein"],
      popularityScore: 50,
    });
    await insertRecipe({
      dietTags: ["keto"],
      popularityScore: 5,
      isPublic: false,
    }); // excluded

    const terms = await getTrendingSearchTerms(5);
    expect(terms[0]).toBe("vegan"); // 150 total
    expect(terms).toContain("Italian");
    expect(terms).toContain("high-protein");
    expect(terms).not.toContain("keto"); // private
  });
});
