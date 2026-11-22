import { fireAndForget } from "../lib/fire-and-forget";
import { validateRecipeQuality } from "../lib/recipe-validation";
import { normalizeRecipeFields } from "../lib/recipe-normalization";
import { inferMealTypes } from "./meal-type-inference";
import { autoGenerateRecipeImage, sharedDishImage } from "./recipe-auto-image";

interface PrepareInput {
  title: string;
  instructions?: string[] | null;
  imageUrl?: string | null;
  sourceType?: string | null;
  ingredients?: { name: string }[] | null;
}

export type PreparedMealPlanRecipe<T extends PrepareInput> =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** The input minus `ingredients` and `sourceType`; not normalized. */
      recipeData: Omit<T, "ingredients" | "sourceType">;
      ingredients: T["ingredients"];
      sourceType: T["sourceType"];
      mealTypes: ReturnType<typeof inferMealTypes>;
      /** Shared dish-picture key, so a new picture is recorded under it. */
      imageKey: string | null;
      /** Picture already made for this dish name, when one exists. */
      sharedImageUrl: string | null;
    };

/**
 * The checks and lookups both meal-plan recipe-create routes run before they
 * store: quality gate, shared dish picture, meal-type inference. Normalization
 * is NOT done here — `/recipes` gets it from storage and `/items` applies it
 * in the route, as before.
 */
export async function prepareMealPlanRecipe<T extends PrepareInput>(
  input: T,
  // Reserved for ownership-scoped checks; the shared dish lookup is global.
  _userId: string,
): Promise<PreparedMealPlanRecipe<T>> {
  const { ingredients, sourceType, ...recipeData } = input;
  const quality = validateRecipeQuality({
    title: recipeData.title,
    instructions: recipeData.instructions,
    ingredients: ingredients ?? null,
    sourceType: sourceType ?? undefined,
  });
  if (!quality.valid) {
    return { ok: false, reason: quality.reason! };
  }

  // A quick entry reuses the picture already made for its dish name.
  const shared = await sharedDishImage(
    sourceType,
    recipeData.title,
    recipeData.imageUrl,
  );

  // normalizeRecipeFields feeds inferMealTypes clean title/ingredient input;
  // persistence normalization happens in storage.
  const normalized = normalizeRecipeFields({
    title: recipeData.title,
    ingredients: ingredients ?? undefined,
  });
  const mealTypes = inferMealTypes(
    normalized.title ?? recipeData.title,
    normalized.ingredients?.map((i) => i.name),
  );

  return {
    ok: true,
    recipeData: recipeData as Omit<T, "ingredients" | "sourceType">,
    ingredients,
    sourceType,
    mealTypes,
    imageKey: shared.key,
    sharedImageUrl: shared.url,
  };
}

/**
 * After the recipe is stored: when it has no picture, generate one in the
 * background. The caller decides `hasImage` (the stored row's picture on
 * `/recipes`, the supplied or shared picture on `/items`).
 */
export function afterRecipeCreated(args: {
  recipe: {
    id: number;
    title: string;
    cuisine: string | null;
    mealTypes: string[] | null;
  };
  userId: string;
  imageKey: string | null;
  hasImage: boolean;
}): void {
  if (args.hasImage) return;
  fireAndForget(
    "recipe-image-gen",
    autoGenerateRecipeImage(args.recipe, args.userId, args.imageKey),
  );
}
