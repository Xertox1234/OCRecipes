import type { ImportedRecipeData } from "@shared/types/recipe-import";

/**
 * The caps the manual-create schema enforces (`createMealPlanRecipeSchema`
 * in server/routes/_meal-plan-schemas.ts). An imported page is written by a
 * stranger, so it gets the same ones: the row stays small, the integer
 * columns cannot overflow, and the recipe passes the edit schema later.
 */
const IMPORT_CAPS = {
  title: 200,
  description: 2000,
  cuisine: 100,
  servings: 50,
  minutes: 1440,
  dietTags: 20,
  dietTagLength: 50,
  ingredients: 200,
  ingredientName: 200,
  ingredientUnit: 50,
  instructions: 100,
  instructionLength: 2000,
  // Same per-food bounds as the photo confirm route.
  calories: 50_000,
  macroGrams: 5000,
} as const;

/** The first `max` UTF-16 units of `text`, never ending on half an emoji. */
function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const endsOnHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, endsOnHighSurrogate ? max - 1 : max);
}

/** A count the page gave, held to `max`; null when it gave none. */
function capCount(value: number | null, max: number): number | null {
  return value === null ? null : Math.min(value, max);
}

/** A per-serving amount no real serving has is unreadable, not a value. */
function capAmount(value: string | null, max: number): string | null {
  if (value === null) return null;
  return Number(value) <= max ? value : null;
}

/**
 * Where to break `text` (longer than `max`) so the first piece fits: after a
 * sentence if one ends in the second half of the reach, else at a space
 * there, else mid-text.
 */
function breakPoint(text: string, max: number): number {
  let space = -1;
  for (let at = max; at > max / 2; at--) {
    if (!/\s/.test(text[at])) continue;
    if (/[.!?]/.test(text[at - 1])) return at;
    if (space === -1) space = at;
  }
  return space === -1 ? cutText(text, max).length : space;
}

/**
 * The steps, each within `maxLength`, at most `maxSteps` of them. Many pages
 * give the whole method as one block; cutting that at the length cap would
 * drop the end of the recipe without a word, so an over-long step becomes
 * several steps. Text is lost only past `maxSteps`.
 */
function capSteps(
  steps: string[],
  maxSteps: number,
  maxLength: number,
): string[] {
  const out: string[] = [];
  for (const step of steps) {
    let rest = step;
    while (rest.length > maxLength) {
      if (out.length === maxSteps) return out;
      const at = breakPoint(rest, maxLength);
      out.push(rest.slice(0, at).trimEnd());
      rest = rest.slice(at).trimStart();
    }
    if (out.length === maxSteps) return out;
    out.push(rest);
  }
  return out;
}

export function capImportedRecipe(
  data: ImportedRecipeData,
): ImportedRecipeData {
  const c = IMPORT_CAPS;
  return {
    ...data,
    title: cutText(data.title, c.title),
    description:
      data.description === null
        ? null
        : cutText(data.description, c.description),
    cuisine: data.cuisine === null ? null : cutText(data.cuisine, c.cuisine),
    servings: capCount(data.servings, c.servings),
    prepTimeMinutes: capCount(data.prepTimeMinutes, c.minutes),
    cookTimeMinutes: capCount(data.cookTimeMinutes, c.minutes),
    dietTags: data.dietTags
      .slice(0, c.dietTags)
      .map((tag) => cutText(tag, c.dietTagLength)),
    ingredients: data.ingredients.slice(0, c.ingredients).map((ing) => ({
      ...ing,
      name: cutText(ing.name, c.ingredientName),
      unit: ing.unit === null ? null : cutText(ing.unit, c.ingredientUnit),
    })),
    instructions:
      data.instructions === null
        ? null
        : capSteps(data.instructions, c.instructions, c.instructionLength),
    caloriesPerServing: capAmount(data.caloriesPerServing, c.calories),
    proteinPerServing: capAmount(data.proteinPerServing, c.macroGrams),
    carbsPerServing: capAmount(data.carbsPerServing, c.macroGrams),
    fatPerServing: capAmount(data.fatPerServing, c.macroGrams),
  };
}
