/**
 * Pure state and step rules for the New Cookbook wizard. Extracted so Vitest
 * can cover them without rendering — no React or React Native imports here.
 */
import {
  DEFAULT_COOKBOOK_COVER_STYLE,
  type CookbookCoverStyle,
} from "@shared/constants/cookbook-cover-styles";

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
  /** A cover-studio candidate, attached by id once the book exists. */
  | { kind: "candidate"; candidateId: string; imageUrl: string };

export interface CoverCandidate {
  id: string;
  imageUrl: string;
}

/** The AI cover studio's inputs and its current set of candidates. */
export interface CoverStudioState {
  /** The "Generate with AI" card is selected. */
  open: boolean;
  prompt: string;
  style: CookbookCoverStyle;
  candidates: CoverCandidate[];
}

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
  studio: CoverStudioState;
  recipes: WizardRecipe[];
}

export const initialWizardState: WizardState = {
  step: "basics",
  furthest: 0,
  name: "",
  description: "",
  cover: { kind: "none" },
  studio: {
    open: false,
    prompt: "",
    style: DEFAULT_COOKBOOK_COVER_STYLE,
    candidates: [],
  },
  recipes: [],
};

export type WizardAction =
  | { type: "setName"; value: string }
  | { type: "setDescription"; value: string }
  | { type: "setCover"; cover: WizardCover }
  | { type: "openStudio" }
  | { type: "closeStudio" }
  | { type: "setCoverPrompt"; value: string }
  | { type: "setCoverStyle"; style: CookbookCoverStyle }
  | { type: "setCandidates"; candidates: CoverCandidate[] }
  | { type: "pickCandidate"; candidate: CoverCandidate }
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
      // A photo and the studio are the two cover sources; choosing a photo
      // closes the studio (keeping its prompt and set for a later return).
      return {
        ...state,
        cover: action.cover,
        studio:
          action.cover.kind === "photo"
            ? { ...state.studio, open: false }
            : state.studio,
      };
    case "openStudio":
      return {
        ...state,
        // Drops a photo so only one cover source reads as selected.
        cover: state.cover.kind === "photo" ? { kind: "none" } : state.cover,
        studio: { ...state.studio, open: true },
      };
    case "closeStudio":
      return {
        ...state,
        cover:
          state.cover.kind === "candidate" ? { kind: "none" } : state.cover,
        studio: { ...state.studio, open: false },
      };
    case "setCoverPrompt":
      return { ...state, studio: { ...state.studio, prompt: action.value } };
    case "setCoverStyle":
      return { ...state, studio: { ...state.studio, style: action.style } };
    case "setCandidates": {
      // The server deleted the previous set when this one was stored, so a
      // pick from it can no longer be attached.
      const { cover } = state;
      const stale =
        cover.kind === "candidate" &&
        !action.candidates.some((c) => c.id === cover.candidateId);
      return {
        ...state,
        cover: stale ? { kind: "none" } : cover,
        studio: { ...state.studio, candidates: action.candidates },
      };
    }
    case "pickCandidate":
      return {
        ...state,
        cover: {
          kind: "candidate",
          candidateId: action.candidate.id,
          imageUrl: action.candidate.imageUrl,
        },
      };
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
