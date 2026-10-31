import { describe, it, expect } from "vitest";
import {
  WIZARD_STEPS,
  initialWizardState,
  recipeKey,
  stepBlocker,
  wizardReducer,
  type WizardRecipe,
  type WizardState,
} from "../cookbook-wizard-utils";

const named = (name: string): WizardState => ({
  ...initialWizardState,
  name,
});

const recipe = (
  recipeId: number,
  recipeType: WizardRecipe["recipeType"] = "mealPlan",
): WizardRecipe => ({
  recipeId,
  recipeType,
  title: `Recipe ${recipeId}`,
  imageUrl: null,
});

describe("WIZARD_STEPS / recipeKey", () => {
  it("lists the steps in order", () => {
    expect(WIZARD_STEPS).toEqual(["basics", "cover", "recipes", "review"]);
  });

  it("builds a type-qualified key", () => {
    expect(recipeKey({ recipeId: 12, recipeType: "mealPlan" })).toBe(
      "mealPlan:12",
    );
  });
});

describe("wizardReducer next", () => {
  it("refuses to leave basics with an empty name", () => {
    const next = wizardReducer(named(""), { type: "next" });
    expect(next.step).toBe("basics");
    expect(next.furthest).toBe(0);
  });

  it("refuses to leave basics with a whitespace name", () => {
    expect(wizardReducer(named("   "), { type: "next" }).step).toBe("basics");
  });

  it("advances to cover with a name and raises furthest", () => {
    const next = wizardReducer(named("Sunday Suppers"), { type: "next" });
    expect(next.step).toBe("cover");
    expect(next.furthest).toBe(1);
  });

  it("advances from recipes to review even with no recipes", () => {
    const s: WizardState = {
      ...named("Sunday Suppers"),
      step: "recipes",
      furthest: 2,
    };
    expect(wizardReducer(s, { type: "next" }).step).toBe("review");
  });

  it("is a no-op from review", () => {
    const s: WizardState = {
      ...named("Sunday Suppers"),
      step: "review",
      furthest: 3,
    };
    expect(wizardReducer(s, { type: "next" })).toEqual(s);
  });
});

describe("stepBlocker", () => {
  it("blocks a blank name on basics", () => {
    expect(stepBlocker(named("  "), "basics", true)).toBe(
      "Enter a name for your cookbook.",
    );
  });

  it("passes a real name on basics", () => {
    expect(stepBlocker(named("Sunday Suppers"), "basics", true)).toBeNull();
  });

  it("never blocks the cover step, whatever the cover", () => {
    const base = named("Sunday Suppers");
    expect(
      stepBlocker({ ...base, cover: { kind: "none" } }, "cover", true),
    ).toBeNull();
    expect(
      stepBlocker(
        { ...base, cover: { kind: "photo", uri: "file:///a.jpg" } },
        "cover",
        true,
      ),
    ).toBeNull();
    expect(
      stepBlocker({ ...base, cover: { kind: "generate" } }, "cover", true),
    ).toBeNull();
  });

  it("asks for a recipe when some exist but none are picked", () => {
    expect(stepBlocker(named("X"), "recipes", true)).toBe(
      "Pick at least one recipe.",
    );
  });

  it("lets recipes through when the user has none to pick", () => {
    expect(stepBlocker(named("X"), "recipes", false)).toBeNull();
  });

  it("passes recipes once one is picked", () => {
    const s = { ...named("X"), recipes: [recipe(1)] };
    expect(stepBlocker(s, "recipes", true)).toBeNull();
  });
});

describe("wizardReducer field updates", () => {
  it("sets name and description", () => {
    let s = wizardReducer(initialWizardState, { type: "setName", value: "A" });
    s = wizardReducer(s, { type: "setDescription", value: "B" });
    expect(s.name).toBe("A");
    expect(s.description).toBe("B");
  });

  it("toggleRecipe adds, then removes the same key", () => {
    const added = wizardReducer(initialWizardState, {
      type: "toggleRecipe",
      recipe: recipe(3),
    });
    expect(added.recipes).toHaveLength(1);
    const removed = wizardReducer(added, {
      type: "toggleRecipe",
      recipe: recipe(3),
    });
    expect(removed.recipes).toHaveLength(0);
  });

  it("treats mealPlan:3 and community:3 as distinct", () => {
    let s = wizardReducer(initialWizardState, {
      type: "toggleRecipe",
      recipe: recipe(3, "mealPlan"),
    });
    s = wizardReducer(s, {
      type: "toggleRecipe",
      recipe: recipe(3, "community"),
    });
    expect(s.recipes.map(recipeKey)).toEqual(["mealPlan:3", "community:3"]);
  });

  it("setCover swaps photo and generate", () => {
    let s = wizardReducer(initialWizardState, {
      type: "setCover",
      cover: { kind: "photo", uri: "file:///a.jpg" },
    });
    expect(s.cover).toEqual({ kind: "photo", uri: "file:///a.jpg" });
    s = wizardReducer(s, { type: "setCover", cover: { kind: "generate" } });
    expect(s.cover).toEqual({ kind: "generate" });
    s = wizardReducer(s, {
      type: "setCover",
      cover: { kind: "photo", uri: "file:///b.jpg" },
    });
    expect(s.cover).toEqual({ kind: "photo", uri: "file:///b.jpg" });
  });
});

describe("wizardReducer navigation", () => {
  const atReview: WizardState = {
    step: "review",
    furthest: 3,
    name: "Sunday Suppers",
    description: "Slow food",
    cover: { kind: "generate" },
    recipes: [recipe(1)],
  };

  it("goTo recipes from review keeps all content", () => {
    const s = wizardReducer(atReview, { type: "goTo", step: "recipes" });
    expect(s.step).toBe("recipes");
    expect(s.name).toBe("Sunday Suppers");
    expect(s.description).toBe("Slow food");
    expect(s.cover).toEqual({ kind: "generate" });
    expect(s.recipes).toEqual([recipe(1)]);
  });

  it("goTo does not lower furthest", () => {
    expect(
      wizardReducer(atReview, { type: "goTo", step: "basics" }).furthest,
    ).toBe(3);
  });

  it("goTo a step past furthest is a no-op", () => {
    const s: WizardState = { ...named("X"), step: "basics", furthest: 1 };
    expect(wizardReducer(s, { type: "goTo", step: "recipes" })).toEqual(s);
  });

  it("back from basics is a no-op", () => {
    expect(wizardReducer(initialWizardState, { type: "back" })).toEqual(
      initialWizardState,
    );
  });

  it("back from review lands on recipes", () => {
    expect(wizardReducer(atReview, { type: "back" }).step).toBe("recipes");
  });
});
