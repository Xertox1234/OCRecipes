import type { GroceryList, GroceryListItem, PantryItem } from "@shared/schema";

const groceryListDefaults: GroceryList = {
  id: 1,
  userId: "1",
  title: "Test Grocery List",
  dateRangeStart: "2024-01-01",
  dateRangeEnd: "2024-01-07",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockGroceryList(
  overrides: Partial<GroceryList> = {},
): GroceryList {
  return { ...groceryListDefaults, ...overrides };
}

const groceryListItemDefaults: GroceryListItem = {
  id: 1,
  groceryListId: 1,
  name: "Test Item",
  quantity: "1",
  unit: null,
  category: "other",
  isChecked: false,
  isManual: false,
  addedToPantry: false,
  checkedAt: null,
};

export function createMockGroceryListItem(
  overrides: Partial<GroceryListItem> = {},
): GroceryListItem {
  return { ...groceryListItemDefaults, ...overrides };
}

const pantryItemDefaults: PantryItem = {
  id: 1,
  userId: "1",
  name: "Test Pantry Item",
  quantity: "1",
  unit: null,
  category: "other",
  expiresAt: null,
  addedAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockPantryItem(
  overrides: Partial<PantryItem> = {},
): PantryItem {
  return { ...pantryItemDefaults, ...overrides };
}
