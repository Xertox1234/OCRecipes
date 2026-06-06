/**
 * CCPA/PIPEDA data-portability export.
 *
 * Aggregates all user-owned rows across every domain into a single object.
 * Strips system fields (password, tokenVersion) at the storage layer so the
 * route handler cannot accidentally leak them.
 *
 * Unlike the standard `get<Domain>` storage helpers, this module does NOT
 * paginate — the contract is "everything we hold for this user." Callers
 * should pipe the result straight into `res.json()` after attaching the
 * export envelope (exportedAt, appVersion).
 */
import {
  users,
  userProfiles,
  scannedItems,
  dailyLogs,
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
  communityRecipes,
  chatConversations,
  chatMessages,
  groceryLists,
  groceryListItems,
  cookbooks,
  cookbookRecipes,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, isNull, inArray, asc, desc } from "drizzle-orm";

// Explicit allowlist of user-account columns that are safe to export. Using an
// allowlist (rather than blocklisting `password`/`tokenVersion`) means any new
// internal column added to the schema is excluded by default — adding it to
// the export must be a deliberate edit here, not an accidental side-effect.
// Exported so the test suite can statically assert sensitive columns are absent.
export const exportUserColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  dailyCalorieGoal: users.dailyCalorieGoal,
  dailyProteinGoal: users.dailyProteinGoal,
  dailyCarbsGoal: users.dailyCarbsGoal,
  dailyFatGoal: users.dailyFatGoal,
  weight: users.weight,
  height: users.height,
  age: users.age,
  gender: users.gender,
  goalWeight: users.goalWeight,
  goalsCalculatedAt: users.goalsCalculatedAt,
  adaptiveGoalsEnabled: users.adaptiveGoalsEnabled,
  lastGoalAdjustmentAt: users.lastGoalAdjustmentAt,
  onboardingCompleted: users.onboardingCompleted,
  subscriptionTier: users.subscriptionTier,
  subscriptionExpiresAt: users.subscriptionExpiresAt,
  createdAt: users.createdAt,
} as const;

export interface UserDataExport {
  profile: {
    account: Record<string, unknown> | null;
    dietary: Record<string, unknown> | null;
  };
  scannedItems: Record<string, unknown>[];
  nutritionLogs: Record<string, unknown>[];
  mealPlans: {
    recipes: Record<string, unknown>[];
    items: Record<string, unknown>[];
  };
  recipes: Record<string, unknown>[];
  chatHistory: {
    conversations: Record<string, unknown>[];
    messages: Record<string, unknown>[];
  };
  groceryLists: {
    lists: Record<string, unknown>[];
    items: Record<string, unknown>[];
  };
  cookbooks: {
    cookbooks: Record<string, unknown>[];
    recipes: Record<string, unknown>[];
  };
}

/**
 * Strip system / internal metadata from chat messages.
 * `turnKey` is the dedupe key used by the coach turn pipeline — it is not
 * user-facing data and should not appear in the export.
 */
function sanitizeChatMessage(
  msg: typeof chatMessages.$inferSelect,
): Record<string, unknown> {
  const { turnKey: _turnKey, ...safe } = msg;
  return safe;
}

/**
 * Aggregate every row this user owns across every domain. Runs all top-level
 * fetches in parallel — the contract is one consolidated export, so there is
 * no incremental progress to stream.
 */
export async function getUserDataExport(
  userId: string,
): Promise<UserDataExport> {
  const [
    accountRow,
    dietaryRow,
    scannedRows,
    dailyLogRows,
    mealPlanRecipeRows,
    mealPlanItemRows,
    userRecipeRows,
    chatConversationRows,
    chatMessageRows,
    groceryListRows,
    groceryListItemRows,
    cookbookRows,
    cookbookRecipeRows,
  ] = await Promise.all([
    db.select(exportUserColumns).from(users).where(eq(users.id, userId)),
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)),
    db
      .select()
      .from(scannedItems)
      .where(
        and(eq(scannedItems.userId, userId), isNull(scannedItems.discardedAt)),
      )
      .orderBy(desc(scannedItems.scannedAt)),
    db
      .select()
      .from(dailyLogs)
      .where(eq(dailyLogs.userId, userId))
      .orderBy(desc(dailyLogs.loggedAt)),
    db
      .select()
      .from(mealPlanRecipes)
      .where(eq(mealPlanRecipes.userId, userId))
      .orderBy(desc(mealPlanRecipes.createdAt)),
    db
      .select()
      .from(mealPlanItems)
      .where(eq(mealPlanItems.userId, userId))
      .orderBy(asc(mealPlanItems.plannedDate)),
    db
      .select()
      .from(communityRecipes)
      .where(eq(communityRecipes.authorId, userId))
      .orderBy(desc(communityRecipes.createdAt)),
    db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.userId, userId))
      .orderBy(desc(chatConversations.updatedAt)),
    // Chat messages: join through conversations to enforce ownership at the SQL
    // layer (so a future bug that pollutes `chatMessages.userId` can't leak rows).
    db
      .select({ message: chatMessages })
      .from(chatMessages)
      .innerJoin(
        chatConversations,
        eq(chatMessages.conversationId, chatConversations.id),
      )
      .where(eq(chatConversations.userId, userId))
      .orderBy(asc(chatMessages.createdAt)),
    db
      .select()
      .from(groceryLists)
      .where(eq(groceryLists.userId, userId))
      .orderBy(desc(groceryLists.createdAt)),
    // Grocery list items: scope through groceryLists.userId via JOIN.
    db
      .select({ item: groceryListItems })
      .from(groceryListItems)
      .innerJoin(
        groceryLists,
        eq(groceryListItems.groceryListId, groceryLists.id),
      )
      .where(eq(groceryLists.userId, userId)),
    db
      .select()
      .from(cookbooks)
      .where(eq(cookbooks.userId, userId))
      .orderBy(desc(cookbooks.updatedAt)),
    // Cookbook recipes: scope through cookbooks.userId via JOIN.
    db
      .select({ recipe: cookbookRecipes })
      .from(cookbookRecipes)
      .innerJoin(cookbooks, eq(cookbookRecipes.cookbookId, cookbooks.id))
      .where(eq(cookbooks.userId, userId)),
  ]);

  // After fetching all parent rows, batch-load meal-plan recipe ingredients
  // (one extra round-trip; cannot be parallelised with the meal-plan recipes
  // fetch above because we need the recipe IDs).
  const recipeIds = mealPlanRecipeRows.map((r) => r.id);
  const ingredientRows = recipeIds.length
    ? await db
        .select()
        .from(recipeIngredients)
        .where(inArray(recipeIngredients.recipeId, recipeIds))
        .orderBy(
          asc(recipeIngredients.recipeId),
          asc(recipeIngredients.displayOrder),
        )
    : [];

  // Attach ingredients to their parent recipe rather than nesting via Map
  // lookups in the route layer — the export shape stays flat and predictable.
  const ingredientsByRecipe = new Map<number, typeof ingredientRows>();
  for (const ing of ingredientRows) {
    const list = ingredientsByRecipe.get(ing.recipeId) ?? [];
    list.push(ing);
    ingredientsByRecipe.set(ing.recipeId, list);
  }
  const mealPlanRecipesWithIngredients = mealPlanRecipeRows.map((recipe) => ({
    ...recipe,
    ingredients: ingredientsByRecipe.get(recipe.id) ?? [],
  }));

  return {
    profile: {
      account: accountRow[0] ?? null,
      dietary: dietaryRow[0] ?? null,
    },
    scannedItems: scannedRows,
    nutritionLogs: dailyLogRows,
    mealPlans: {
      recipes: mealPlanRecipesWithIngredients,
      items: mealPlanItemRows,
    },
    recipes: userRecipeRows,
    chatHistory: {
      conversations: chatConversationRows,
      messages: chatMessageRows.map((r) => sanitizeChatMessage(r.message)),
    },
    groceryLists: {
      lists: groceryListRows,
      items: groceryListItemRows.map((r) => r.item),
    },
    cookbooks: {
      cookbooks: cookbookRows,
      recipes: cookbookRecipeRows.map((r) => r.recipe),
    },
  };
}
