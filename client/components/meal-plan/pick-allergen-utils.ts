import {
  deriveRecipeAllergens,
  type DerivedRecipeAllergen,
} from "@shared/constants/allergens";
import type { PlanAudienceChoice } from "@/lib/plan-audience";
import type { PlanFamily } from "@/hooks/useFamily";
import { describeClash, getEaters, getMealClashes } from "./family-utils";

/**
 * What is known about a meal at the moment it is picked: its allergens, or
 * null when they cannot be checked (not derived yet, no ingredients stored,
 * or the recipe could not be read).
 */
export interface PickedMeal {
  allergens: DerivedRecipeAllergen[] | null;
}

export const UNCHECKED_MEAL: PickedMeal = { allergens: null };

/**
 * A saved recipe. A recipe with no ingredients is stored with an empty
 * allergen list, which reads as "none found": it was never analysed, so it
 * is not checked, never safe.
 */
export function pickedFromRecipe(recipe: {
  allergens: DerivedRecipeAllergen[] | null;
  ingredients: readonly unknown[];
}): PickedMeal {
  return recipe.ingredients.length > 0
    ? { allergens: recipe.allergens }
    : UNCHECKED_MEAL;
}

/**
 * A recipe not saved yet: the same derivation the server runs on save. The
 * server first collapses runs of whitespace (`normalizeTitle`), and the
 * allergen keywords match multi-word text, so a pasted "monkey\u00a0nut" must
 * be read as "monkey nut" here too or it would miss a clash the server finds.
 */
export function pickedFromIngredientNames(names: string[]): PickedMeal {
  const tidy = names
    .map((n) => n.trim().split(/\s+/).join(" "))
    .filter(Boolean);
  return tidy.length > 0
    ? { allergens: deriveRecipeAllergens(tidy) }
    : UNCHECKED_MEAL;
}

/** A clash to confirm, a meal that could not be checked, or nothing to say. */
export type PickWarning =
  | { kind: "clash"; lines: string[] }
  | { kind: "unchecked" }
  | null;

/** Whether anyone the meal is for has an allergy: otherwise nothing to check. */
export function pickNeedsCheck(
  choice: PlanAudienceChoice,
  family: PlanFamily,
): boolean {
  // A profile missing from the list may still exist on the server: its
  // allergies are unknown, so it is checked (and comes out "not checked").
  if (isMissingProfile(choice, family)) return true;
  return getEaters(
    choice,
    { allergies: family.userAllergies },
    family.profiles,
  ).some((e) => e.allergies.length > 0);
}

function isMissingProfile(
  choice: PlanAudienceChoice,
  family: PlanFamily,
): boolean {
  return (
    choice.audience === "profile" &&
    !family.profiles.some((p) => p.id === choice.familyProfileId)
  );
}

/**
 * The allergen check for a meal about to be added to the plan, against
 * whoever it is for (owner decision 2026-11-20). The day screen's clash rule;
 * a possible allergen warns too. Unknown allergens are never passed as safe.
 */
export function getPickWarning(
  meal: PickedMeal,
  choice: PlanAudienceChoice,
  family: PlanFamily,
): PickWarning {
  if (isMissingProfile(choice, family)) return { kind: "unchecked" };
  const eaters = getEaters(
    choice,
    { allergies: family.userAllergies },
    family.profiles,
  );
  const clashes = getMealClashes(
    { recipe: { allergens: meal.allergens }, scannedItem: null },
    eaters,
  );
  if (clashes === "unknown") return { kind: "unchecked" };
  return clashes.length > 0
    ? { kind: "clash", lines: clashes.map(describeClash) }
    : null;
}

/** The confirm step for a clash: the add goes ahead only on "Add anyway". */
export function pickClashPrompt(lines: string[]): {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
} {
  return {
    title: "Allergy check",
    message: `${lines.join("\n")}\n\nAdd it to the plan anyway?`,
    confirm: "Add anyway",
    cancel: "Cancel",
  };
}

/** A meal in a plan saved in one go (the pantry-generated plan). */
export interface BatchMeal {
  title: string;
  meal: PickedMeal;
}

const SELF_CHOICE: PlanAudienceChoice = {
  audience: "self",
  familyProfileId: null,
};

/**
 * The allergen check before a whole generated plan is saved (owner decision
 * 2026-11-28): one summary of every clashing meal, not one confirm per meal.
 * The plan's meals are the user's own, so only the user's allergies count. A
 * clash outranks a meal that cannot be checked.
 */
export function getBatchWarning(
  meals: BatchMeal[],
  family: PlanFamily,
): PickWarning {
  if (!pickNeedsCheck(SELF_CHOICE, family)) return null;
  const lines: string[] = [];
  let unchecked = false;
  for (const { title, meal } of meals) {
    const w = getPickWarning(meal, SELF_CHOICE, family);
    if (w?.kind === "clash") {
      for (const line of w.lines) lines.push(`${title}: ${line}`);
    } else if (w?.kind === "unchecked") {
      unchecked = true;
    }
  }
  if (lines.length > 0) return { kind: "clash", lines };
  return unchecked ? { kind: "unchecked" } : null;
}

/** The confirm step before saving a plan with a clash. */
export function batchClashPrompt(lines: string[]): {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
} {
  return {
    title: "Allergy check",
    message: `${lines.join("\n")}\n\nSave the plan anyway?`,
    confirm: "Save anyway",
    cancel: "Cancel",
  };
}

/** The success toast, with the "not checked" note when there is one. */
export function withAllergenNote(message: string, note: string | null): string {
  return note ? `${message}. ${note}.` : message;
}
