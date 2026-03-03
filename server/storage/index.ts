/**
 * Storage layer -- domain-specific modules composed into a single object.
 *
 * Other files continue to import as before:
 *   import { storage } from "../storage";
 *
 * The `escapeLike` and `getDayBounds` helpers are also re-exported for any
 * consumer that needs them.
 */

import * as users from "./users";
import * as nutrition from "./nutrition";
import * as mealPlans from "./meal-plans";
import * as activity from "./activity";
import * as chat from "./chat";
import * as cache from "./cache";
import * as community from "./community";
import * as medication from "./medication";
import * as fasting from "./fasting";
import * as menu from "./menu";

export { escapeLike, getDayBounds } from "./helpers";

export const storage = {
  // Users & profiles
  getUser: users.getUser,
  getUserByUsername: users.getUserByUsername,
  createUser: users.createUser,
  updateUser: users.updateUser,
  getUserProfile: users.getUserProfile,
  createUserProfile: users.createUserProfile,
  updateUserProfile: users.updateUserProfile,
  getSubscriptionStatus: users.getSubscriptionStatus,
  updateSubscription: users.updateSubscription,
  getTransaction: users.getTransaction,
  createTransaction: users.createTransaction,

  // Nutrition (scanned items, daily logs, saved items)
  getScannedItems: nutrition.getScannedItems,
  getScannedItem: nutrition.getScannedItem,
  getScannedItemsByIds: nutrition.getScannedItemsByIds,
  getScannedItemWithFavourite: nutrition.getScannedItemWithFavourite,
  createScannedItem: nutrition.createScannedItem,
  softDeleteScannedItem: nutrition.softDeleteScannedItem,
  toggleFavouriteScannedItem: nutrition.toggleFavouriteScannedItem,
  getDailyLogs: nutrition.getDailyLogs,
  createDailyLog: nutrition.createDailyLog,
  getDailySummary: nutrition.getDailySummary,
  getDailyScanCount: nutrition.getDailyScanCount,
  getSavedItems: nutrition.getSavedItems,
  getSavedItemCount: nutrition.getSavedItemCount,
  createSavedItem: nutrition.createSavedItem,
  deleteSavedItem: nutrition.deleteSavedItem,

  // Meal plans (recipes, items, grocery, pantry)
  findMealPlanRecipeByExternalId: mealPlans.findMealPlanRecipeByExternalId,
  getMealPlanRecipe: mealPlans.getMealPlanRecipe,
  getMealPlanRecipeWithIngredients: mealPlans.getMealPlanRecipeWithIngredients,
  getUserMealPlanRecipes: mealPlans.getUserMealPlanRecipes,
  createMealPlanRecipe: mealPlans.createMealPlanRecipe,
  updateMealPlanRecipe: mealPlans.updateMealPlanRecipe,
  deleteMealPlanRecipe: mealPlans.deleteMealPlanRecipe,
  getUnifiedRecipes: mealPlans.getUnifiedRecipes,
  getMealPlanItems: mealPlans.getMealPlanItems,
  getMealPlanItemById: mealPlans.getMealPlanItemById,
  addMealPlanItem: mealPlans.addMealPlanItem,
  removeMealPlanItem: mealPlans.removeMealPlanItem,
  reorderMealPlanItems: mealPlans.reorderMealPlanItems,
  createGroceryList: mealPlans.createGroceryList,
  getGroceryLists: mealPlans.getGroceryLists,
  getGroceryListWithItems: mealPlans.getGroceryListWithItems,
  deleteGroceryList: mealPlans.deleteGroceryList,
  addGroceryListItem: mealPlans.addGroceryListItem,
  addGroceryListItems: mealPlans.addGroceryListItems,
  updateGroceryListItemChecked: mealPlans.updateGroceryListItemChecked,
  deleteGroceryListItem: mealPlans.deleteGroceryListItem,
  updateGroceryListItemPantryFlag: mealPlans.updateGroceryListItemPantryFlag,
  getPantryItems: mealPlans.getPantryItems,
  getPantryItem: mealPlans.getPantryItem,
  createPantryItem: mealPlans.createPantryItem,
  updatePantryItem: mealPlans.updatePantryItem,
  deletePantryItem: mealPlans.deletePantryItem,
  getExpiringPantryItems: mealPlans.getExpiringPantryItems,
  getConfirmedMealPlanItemIds: mealPlans.getConfirmedMealPlanItemIds,
  getPlannedNutritionSummary: mealPlans.getPlannedNutritionSummary,
  getMealPlanIngredientsForDateRange:
    mealPlans.getMealPlanIngredientsForDateRange,

  // Activity (exercise, weight, healthkit)
  getWeightLogs: activity.getWeightLogs,
  createWeightLog: activity.createWeightLog,
  deleteWeightLog: activity.deleteWeightLog,
  getLatestWeight: activity.getLatestWeight,
  getExerciseLogs: activity.getExerciseLogs,
  createExerciseLog: activity.createExerciseLog,
  updateExerciseLog: activity.updateExerciseLog,
  deleteExerciseLog: activity.deleteExerciseLog,
  getExerciseDailySummary: activity.getExerciseDailySummary,
  searchExerciseLibrary: activity.searchExerciseLibrary,
  createExerciseLibraryEntry: activity.createExerciseLibraryEntry,
  getHealthKitSyncSettings: activity.getHealthKitSyncSettings,
  upsertHealthKitSyncSetting: activity.upsertHealthKitSyncSetting,
  updateHealthKitLastSync: activity.updateHealthKitLastSync,

  // Chat
  getChatConversation: chat.getChatConversation,
  getChatConversations: chat.getChatConversations,
  createChatConversation: chat.createChatConversation,
  getChatMessages: chat.getChatMessages,
  createChatMessage: chat.createChatMessage,
  deleteChatConversation: chat.deleteChatConversation,
  updateChatConversationTitle: chat.updateChatConversationTitle,
  getDailyChatMessageCount: chat.getDailyChatMessageCount,

  // Cache (suggestions, instructions, meal suggestions, micronutrients)
  getSuggestionCache: cache.getSuggestionCache,
  createSuggestionCache: cache.createSuggestionCache,
  incrementSuggestionCacheHit: cache.incrementSuggestionCacheHit,
  getInstructionCache: cache.getInstructionCache,
  createInstructionCache: cache.createInstructionCache,
  incrementInstructionCacheHit: cache.incrementInstructionCacheHit,
  invalidateSuggestionCacheForUser: cache.invalidateSuggestionCacheForUser,
  getMealSuggestionCache: cache.getMealSuggestionCache,
  createMealSuggestionCache: cache.createMealSuggestionCache,
  incrementMealSuggestionCacheHit: cache.incrementMealSuggestionCacheHit,
  getDailyMealSuggestionCount: cache.getDailyMealSuggestionCount,
  getMicronutrientCache: cache.getMicronutrientCache,
  setMicronutrientCache: cache.setMicronutrientCache,

  // Community recipes
  getDailyRecipeGenerationCount: community.getDailyRecipeGenerationCount,
  logRecipeGeneration: community.logRecipeGeneration,
  getCommunityRecipes: community.getCommunityRecipes,
  createCommunityRecipe: community.createCommunityRecipe,
  updateRecipePublicStatus: community.updateRecipePublicStatus,
  getCommunityRecipe: community.getCommunityRecipe,
  getFeaturedRecipes: community.getFeaturedRecipes,
  deleteCommunityRecipe: community.deleteCommunityRecipe,
  getUserRecipes: community.getUserRecipes,

  // Medication & goal adjustment logs
  getMedicationLogs: medication.getMedicationLogs,
  createMedicationLog: medication.createMedicationLog,
  updateMedicationLog: medication.updateMedicationLog,
  deleteMedicationLog: medication.deleteMedicationLog,
  createGoalAdjustmentLog: medication.createGoalAdjustmentLog,
  getGoalAdjustmentLogs: medication.getGoalAdjustmentLogs,

  // Fasting
  getFastingSchedule: fasting.getFastingSchedule,
  upsertFastingSchedule: fasting.upsertFastingSchedule,
  getActiveFastingLog: fasting.getActiveFastingLog,
  getFastingLogs: fasting.getFastingLogs,
  createFastingLog: fasting.createFastingLog,
  endFastingLog: fasting.endFastingLog,

  // Menu scans
  getMenuScans: menu.getMenuScans,
  createMenuScan: menu.createMenuScan,
  deleteMenuScan: menu.deleteMenuScan,
};
