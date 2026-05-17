import type {
  MealPlanRecipe,
  RecipeIngredient,
  MealPlanItem,
  CommunityRecipe,
  RecipeGenerationLog,
  Cookbook,
  CookbookRecipe,
  TastePick,
  RecipeDismissal,
} from "@shared/schema";

const mealPlanRecipeDefaults: MealPlanRecipe = {
  id: 1,
  userId: "1",
  title: "Test Recipe",
  description: null,
  sourceType: "user_created",
  sourceUrl: null,
  externalId: null,
  cuisine: null,
  difficulty: null,
  servings: 2,
  prepTimeMinutes: null,
  cookTimeMinutes: null,
  imageUrl: null,
  instructions: ["Step 1: Prepare ingredients", "Step 2: Cook and serve"],
  dietTags: [],
  mealTypes: [],
  allergens: [],
  caloriesPerServing: null,
  proteinPerServing: null,
  carbsPerServing: null,
  fatPerServing: null,
  fiberPerServing: null,
  sugarPerServing: null,
  sodiumPerServing: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockMealPlanRecipe(
  overrides: Partial<MealPlanRecipe> = {},
): MealPlanRecipe {
  return { ...mealPlanRecipeDefaults, ...overrides };
}

const recipeIngredientDefaults: RecipeIngredient = {
  id: 1,
  recipeId: 1,
  name: "Test Ingredient",
  quantity: "1",
  unit: "cup",
  category: "other",
  displayOrder: 0,
};

export function createMockRecipeIngredient(
  overrides: Partial<RecipeIngredient> = {},
): RecipeIngredient {
  return { ...recipeIngredientDefaults, ...overrides };
}

const mealPlanItemDefaults: MealPlanItem = {
  id: 1,
  userId: "1",
  recipeId: 1,
  scannedItemId: null,
  plannedDate: "2024-01-01",
  mealType: "lunch",
  servings: "1",
  sortOrder: 0,
  createdAt: new Date("2024-01-01"),
};

export function createMockMealPlanItem(
  overrides: Partial<MealPlanItem> = {},
): MealPlanItem {
  return { ...mealPlanItemDefaults, ...overrides };
}

const communityRecipeDefaults: CommunityRecipe = {
  id: 1,
  authorId: "1",
  barcode: null,
  // `test-` prefix: lets `npm run cleanup:seeds` catch leaks automatically
  // without needing to update an allowlist. See
  // `server/scripts/cleanup-seed-recipes-utils.ts`.
  normalizedProductName: "test-product",
  title: "Test Community Recipe",
  description: null,
  difficulty: null,
  timeEstimate: null,
  servings: 2,
  dietTags: [],
  mealTypes: [],
  allergens: [],
  instructions: ["Test instructions"],
  ingredients: [],
  caloriesPerServing: null,
  proteinPerServing: null,
  carbsPerServing: null,
  fatPerServing: null,
  imageUrl: null,
  isPublic: true,
  remixedFromId: null,
  remixedFromTitle: null,
  sourceMessageId: null,
  popularityFavorites: 0,
  popularityMealPlans: 0,
  popularityCookSessions: 0,
  popularityScore: 0,
  isCanonical: false,
  canonicalizedAt: null,
  canonicalEnrichedAt: null,
  canonicalImages: [],
  instructionDetails: [],
  toolsRequired: [],
  chefTips: [],
  cuisineOrigin: null,
  videoUrl: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockCommunityRecipe(
  overrides: Partial<CommunityRecipe> = {},
): CommunityRecipe {
  return { ...communityRecipeDefaults, ...overrides };
}

const recipeGenerationLogDefaults: RecipeGenerationLog = {
  id: 1,
  userId: "1",
  recipeId: null,
  generatedAt: new Date("2024-01-01"),
};

export function createMockRecipeGenerationLog(
  overrides: Partial<RecipeGenerationLog> = {},
): RecipeGenerationLog {
  return { ...recipeGenerationLogDefaults, ...overrides };
}

const cookbookDefaults: Cookbook = {
  id: 1,
  userId: "1",
  name: "Test Cookbook",
  description: null,
  coverImageUrl: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockCookbook(
  overrides: Partial<Cookbook> = {},
): Cookbook {
  return { ...cookbookDefaults, ...overrides };
}

const cookbookRecipeDefaults: CookbookRecipe = {
  id: 1,
  cookbookId: 1,
  recipeId: 1,
  recipeType: "mealPlan",
  addedAt: new Date("2024-01-01"),
};

export function createMockCookbookRecipe(
  overrides: Partial<CookbookRecipe> = {},
): CookbookRecipe {
  return { ...cookbookRecipeDefaults, ...overrides };
}

const tastePickDefaults: TastePick = {
  id: 1,
  userId: "1",
  recipeId: 1,
  pickedAt: new Date("2024-01-01"),
};

export function createMockTastePick(
  overrides: Partial<TastePick> = {},
): TastePick {
  return { ...tastePickDefaults, ...overrides };
}

const recipeDismissalDefaults: RecipeDismissal = {
  id: 1,
  userId: "1",
  // Plain numeric string matches production: `dismissRecipe` writes
  // `String(recipeId)` and read sites use `parseInt(..., 10)` — see
  // `server/storage/carousel.ts`. Override per scenario if a future source
  // adopts a prefixed format (e.g., `mealPlan:N`).
  recipeIdentifier: "1",
  source: "carousel",
  dismissedAt: new Date("2024-01-01"),
};

export function createMockRecipeDismissal(
  overrides: Partial<RecipeDismissal> = {},
): RecipeDismissal {
  return { ...recipeDismissalDefaults, ...overrides };
}
