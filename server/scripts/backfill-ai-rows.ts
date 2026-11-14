/**
 * Row loaders for the backfill scripts that send recipe text to AI companies
 * (spice level, nutrition, images).
 *
 * A script runs outside any signed-in request, so the AI-sharing gate inside
 * `aiChat` sees no user (privacy audit M13). Each loader therefore leaves out
 * recipes whose owner has AI sharing off, in the query itself. They live here,
 * apart from the scripts, so a test can import them: a script runs `main()`
 * when loaded.
 */
import { and, isNull } from "drizzle-orm";
import { communityRecipes, mealPlanRecipes } from "@shared/schema";
import { db } from "../db";
import { ownerAllowsAiSharing } from "../storage/ai-sharing";

const communityOwnerAllows = ownerAllowsAiSharing(communityRecipes.authorId);
const mealPlanOwnerAllows = ownerAllowsAiSharing(mealPlanRecipes.userId);

/** Community recipes with no spice level yet. */
export function loadCommunitySpiceRows() {
  return db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      ingredients: communityRecipes.ingredients,
    })
    .from(communityRecipes)
    .where(and(isNull(communityRecipes.spiceLevel), communityOwnerAllows));
}

/** Meal-plan recipes with no spice level yet. */
export function loadMealPlanSpiceRows() {
  return db
    .select({ id: mealPlanRecipes.id, title: mealPlanRecipes.title })
    .from(mealPlanRecipes)
    .where(and(isNull(mealPlanRecipes.spiceLevel), mealPlanOwnerAllows));
}

/** Community recipes with no nutrition figures yet. */
export function loadCommunityNutritionRows() {
  return db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      ingredients: communityRecipes.ingredients,
      servings: communityRecipes.servings,
    })
    .from(communityRecipes)
    .where(
      and(isNull(communityRecipes.caloriesPerServing), communityOwnerAllows),
    );
}

/** Community recipes whose pictures the image backfill may regenerate. */
export function loadCommunityImageRows() {
  return db
    .select({
      id: communityRecipes.id,
      imageUrl: communityRecipes.imageUrl,
      canonicalImages: communityRecipes.canonicalImages,
      cuisineOrigin: communityRecipes.cuisineOrigin,
      mealTypes: communityRecipes.mealTypes,
      title: communityRecipes.title,
    })
    .from(communityRecipes)
    .where(communityOwnerAllows);
}

/** Meal-plan recipes whose picture the image backfill may regenerate. */
export function loadMealPlanImageRows() {
  return (
    db
      .select({
        id: mealPlanRecipes.id,
        imageUrl: mealPlanRecipes.imageUrl,
        cuisine: mealPlanRecipes.cuisine,
        mealTypes: mealPlanRecipes.mealTypes,
        title: mealPlanRecipes.title,
      })
      .from(mealPlanRecipes)
      // A soft-deleted recipe is invisible — don't pay to regenerate its image.
      .where(and(isNull(mealPlanRecipes.deletedAt), mealPlanOwnerAllows))
  );
}
