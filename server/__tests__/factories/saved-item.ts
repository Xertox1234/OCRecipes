import type { SavedItem } from "@shared/schema";

const savedItemDefaults: SavedItem = {
  id: 1,
  userId: "1",
  type: "recipe",
  title: "Test Saved Item",
  description: null,
  difficulty: null,
  timeEstimate: null,
  instructions: null,
  sourceItemId: null,
  sourceProductName: null,
  recipeId: null,
  recipeType: null,
  createdAt: new Date("2024-01-01"),
};

export function createMockSavedItem(
  overrides: Partial<SavedItem> = {},
): SavedItem {
  return { ...savedItemDefaults, ...overrides };
}
