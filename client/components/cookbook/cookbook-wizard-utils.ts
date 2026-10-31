/**
 * Pure state and step rules for the New Cookbook wizard. Extracted so Vitest
 * can cover them without rendering — no React or React Native imports here.
 */

export type WizardStep = "basics" | "cover" | "recipes" | "review";

export const WIZARD_STEPS: readonly WizardStep[] = [
  "basics",
  "cover",
  "recipes",
  "review",
];

export type WizardCover =
  | { kind: "none" }
  | { kind: "photo"; uri: string }
  | { kind: "generate" };

export interface WizardRecipe {
  recipeId: number;
  recipeType: "mealPlan" | "community";
  title: string;
  imageUrl: string | null;
}

export function recipeKey(
  r: Pick<WizardRecipe, "recipeId" | "recipeType">,
): string {
  return `${r.recipeType}:${r.recipeId}`;
}

export interface WizardState {
  step: WizardStep;
  /** Index into WIZARD_STEPS of the furthest step reached. */
  furthest: number;
  name: string;
  description: string;
  cover: WizardCover;
  recipes: WizardRecipe[];
}

export const initialWizardState: WizardState = {
  step: "basics",
  furthest: 0,
  name: "",
  description: "",
  cover: { kind: "none" },
  recipes: [],
};

export type WizardAction =
  | { type: "setName"; value: string }
  | { type: "setDescription"; value: string }
  | { type: "setCover"; cover: WizardCover }
  | { type: "toggleRecipe"; recipe: WizardRecipe }
  | { type: "next" }
  | { type: "back" }
  | { type: "goTo"; step: WizardStep };

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "setName":
      return { ...state, name: action.value };
    case "setDescription":
      return { ...state, description: action.value };
    case "setCover":
      return { ...state, cover: action.cover };
    case "toggleRecipe": {
      const key = recipeKey(action.recipe);
      const exists = state.recipes.some((r) => recipeKey(r) === key);
      return {
        ...state,
        recipes: exists
          ? state.recipes.filter((r) => recipeKey(r) !== key)
          : [...state.recipes, action.recipe],
      };
    }
    case "next": {
      // The one rule that can never be skipped; every other step rule lives
      // in stepBlocker, which the screen checks before dispatching.
      if (state.step === "basics" && state.name.trim() === "") return state;
      const index = WIZARD_STEPS.indexOf(state.step);
      if (index >= WIZARD_STEPS.length - 1) return state;
      return {
        ...state,
        step: WIZARD_STEPS[index + 1],
        furthest: Math.max(state.furthest, index + 1),
      };
    }
    case "back": {
      const index = WIZARD_STEPS.indexOf(state.step);
      if (index <= 0) return state;
      return { ...state, step: WIZARD_STEPS[index - 1] };
    }
    case "goTo": {
      if (WIZARD_STEPS.indexOf(action.step) > state.furthest) return state;
      return { ...state, step: action.step };
    }
  }
}

/** Why the user can't leave `step` yet, or null when they can. */
export function stepBlocker(
  state: WizardState,
  step: WizardStep,
  hasAnyRecipes: boolean,
): string | null {
  if (step === "basics" && state.name.trim() === "") {
    return "Enter a name for your cookbook.";
  }
  if (step === "recipes" && hasAnyRecipes && state.recipes.length === 0) {
    return "Pick at least one recipe.";
  }
  return null;
}
