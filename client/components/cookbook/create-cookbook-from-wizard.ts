/**
 * Create-then-attach runner for the New Cookbook wizard. A plain async
 * function with injected dependencies, deliberately not a hook: a try/finally
 * inside a hook callback makes React Compiler skip the component.
 */
import { logger } from "@/lib/logger";
import type { WizardState } from "./cookbook-wizard-utils";

export interface CreateCookbookDeps {
  create(input: {
    name: string;
    description?: string;
  }): Promise<{ id: number }>;
  uploadCover(input: { cookbookId: number; uri: string }): Promise<unknown>;
  generateCover(cookbookId: number): Promise<unknown>;
  addRecipe(input: {
    cookbookId: number;
    recipeId: number;
    recipeType: "mealPlan" | "community";
  }): Promise<unknown>;
  onCoverStart?(label: string): void;
}

export interface WizardOutcome {
  cookbookId: number;
  coverFailed: boolean;
  recipesFailed: number;
}

/** Throws only when `create` throws; cover and recipe failures are reported. */
export async function createCookbookFromWizard(
  state: WizardState,
  deps: CreateCookbookDeps,
): Promise<WizardOutcome> {
  const description = state.description.trim();
  const { id: cookbookId } = await deps.create({
    name: state.name.trim(),
    description: description === "" ? undefined : description,
  });

  let coverFailed = false;
  const { cover } = state;
  if (cover.kind !== "none") {
    try {
      if (cover.kind === "photo") {
        deps.onCoverStart?.("Adding your cover…");
        await deps.uploadCover({ cookbookId, uri: cover.uri });
      } else {
        deps.onCoverStart?.("Generating your cover…");
        await deps.generateCover(cookbookId);
      }
    } catch (err) {
      coverFailed = true;
      logger.error("Wizard cover failed:", err);
    }
  }

  let recipesFailed = 0;
  for (const recipe of state.recipes) {
    try {
      await deps.addRecipe({
        cookbookId,
        recipeId: recipe.recipeId,
        recipeType: recipe.recipeType,
      });
    } catch (err) {
      recipesFailed++;
      logger.error("Wizard add recipe failed:", err);
    }
  }

  return { cookbookId, coverFailed, recipesFailed };
}

/** User-facing summary of a partial failure, or null on full success. */
export function describeWizardOutcome(o: {
  coverFailed: boolean;
  recipesFailed: number;
}): string | null {
  const recipes =
    o.recipesFailed === 1 ? "1 recipe" : `${o.recipesFailed} recipes`;
  if (o.coverFailed && o.recipesFailed > 0) {
    return `Cookbook created, but the cover and ${recipes} couldn't be added.`;
  }
  if (o.coverFailed) {
    return "Cookbook created, but the cover couldn't be added. You can add one by editing the cookbook.";
  }
  if (o.recipesFailed > 0) {
    return `Cookbook created, but ${recipes} couldn't be added.`;
  }
  return null;
}
