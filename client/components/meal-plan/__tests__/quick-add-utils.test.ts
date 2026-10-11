import {
  resolveQuickAddAction,
  quickAddRowAccessibilityLabel,
} from "../quick-add-utils";

describe("resolveQuickAddAction", () => {
  it("adds a personal row by its meal-plan recipe id", () => {
    expect(resolveQuickAddAction({ id: 5, source: "personal" })).toEqual({
      kind: "add",
      recipeId: 5,
    });
  });

  it("routes a community row to its detail, never to an add", () => {
    expect(resolveQuickAddAction({ id: 5, source: "community" })).toEqual({
      kind: "view-community",
      communityRecipeId: 5,
    });
  });
});

describe("quickAddRowAccessibilityLabel", () => {
  it("labels a personal row as an add", () => {
    expect(
      quickAddRowAccessibilityLabel(
        { title: "Oats", source: "personal" },
        "300 cal",
        "breakfast",
      ),
    ).toBe("Add Oats, 300 cal to breakfast");
  });

  it("labels a community row as a view", () => {
    expect(
      quickAddRowAccessibilityLabel(
        { title: "Chili", source: "community" },
        null,
        "dinner",
      ),
    ).toBe("View Chili");
  });
});
