import { storage } from "../storage";
import { logger, toError } from "../lib/logger";
import type { CommunityRecipe } from "@shared/schema";

/**
 * Put a recipe the user just made (Make this mine, premium generate) into
 * Profile > Saved items, the list the user looks in for it. Awaited before
 * the response so the client's refetch sees the row. Never throws: the recipe
 * already exists, so a save failure is logged and the request still succeeds.
 */
export async function addMadeRecipeToSavedItems(
  userId: string,
  recipe: Pick<
    CommunityRecipe,
    "id" | "title" | "description" | "difficulty" | "timeEstimate"
  >,
): Promise<void> {
  try {
    await storage.saveRecipeToSavedItems(userId, {
      recipeId: recipe.id,
      recipeType: "community",
      title: recipe.title,
      description: recipe.description,
      difficulty: recipe.difficulty,
      timeEstimate: recipe.timeEstimate,
    });
  } catch (err) {
    logger.error(
      { err: toError(err), recipeId: recipe.id },
      "add made recipe to saved items failed",
    );
  }
}

/**
 * Same, for a recipe known only by id (an already-made inspired card).
 * Skipped when the recipe is gone; a failed lookup is logged, never thrown.
 */
export async function addMadeRecipeIdToSavedItems(
  userId: string,
  recipeId: number,
): Promise<void> {
  let recipe;
  try {
    recipe = await storage.getCommunityRecipe(recipeId, userId);
  } catch (err) {
    logger.error(
      { err: toError(err), recipeId },
      "look up made recipe for saved items failed",
    );
    return;
  }
  if (recipe) await addMadeRecipeToSavedItems(userId, recipe);
}
