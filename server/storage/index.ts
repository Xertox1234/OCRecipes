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
import * as groceryLists from "./grocery-lists";
import * as pantry from "./pantry";
import * as chat from "./chat";
import * as cache from "./cache";
import * as community from "./community";
import * as medication from "./medication";
import * as fasting from "./fasting";
import * as menu from "./menu";
import * as receipt from "./receipt";
import * as cookbooksStorage from "./cookbooks";
import * as favouriteRecipesStorage from "./favourite-recipes";
import * as verification from "./verification";
import * as apiKeysStorage from "./api-keys";
import * as batch from "./batch";
import * as reformulation from "./reformulation";
import * as sessions from "./sessions";
import * as carousel from "./carousel";
import * as profileHub from "./profile-hub";
import * as coachNotebook from "./coach-notebook";
import * as recipeFromChat from "./recipe-from-chat";
import * as health from "./health";

export { escapeLike, getDayBounds, getMonthBounds } from "./helpers";
export type { UpdatableUserFields } from "./users";
export type { FeaturedRecipe } from "./community";
export type { PersonalRecipeBrief } from "./meal-plans";
export { BatchStorageError } from "./batch";
export { MAX_IMAGE_SIZE_BYTES, warmUpStore } from "./sessions";
export type { CookingSession } from "./sessions";

export const storage = {
  // Users & profiles
  getUser: users.getUser,
  getUserByUsername: users.getUserByUsername,
  getUserForAuth: users.getUserForAuth,
  getUserByUsernameForAuth: users.getUserByUsernameForAuth,
  createUser: users.createUser,
  updateUser: users.updateUser,
  incrementTokenVersion: users.incrementTokenVersion,
  deleteUser: users.deleteUser,
  getUserProfile: users.getUserProfile,
  createUserProfile: users.createUserProfile,
  updateUserProfile: users.updateUserProfile,
  upsertProfileWithOnboarding: users.upsertProfileWithOnboarding,
  updateUserGoalsAndProfile: users.updateUserGoalsAndProfile,
  getSubscriptionStatus: users.getSubscriptionStatus,
  updateSubscription: users.updateSubscription,
  getTransaction: users.getTransaction,
  createTransaction: users.createTransaction,
  createTransactionAndUpgrade: users.createTransactionAndUpgrade,

  // Nutrition (scanned items, daily logs, saved items)
  getScannedItems: nutrition.getScannedItems,
  getScannedItem: nutrition.getScannedItem,
  getScannedItemsByIds: nutrition.getScannedItemsByIds,
  getScannedItemWithFavourite: nutrition.getScannedItemWithFavourite,
  createScannedItem: nutrition.createScannedItem,
  softDeleteScannedItem: nutrition.softDeleteScannedItem,
  toggleFavouriteScannedItem: nutrition.toggleFavouriteScannedItem,
  getFrequentItems: nutrition.getFrequentItems,
  getDailyLogs: nutrition.getDailyLogs,
  getDailyLogsInRange: nutrition.getDailyLogsInRange,
  createDailyLog: nutrition.createDailyLog,
  createScannedItemWithLog: nutrition.createScannedItemWithLog,
  getDailySummary: nutrition.getDailySummary,
  getDailyScanCount: nutrition.getDailyScanCount,
  getSavedItems: nutrition.getSavedItems,
  getSavedItemCount: nutrition.getSavedItemCount,
  createSavedItem: nutrition.createSavedItem,
  deleteSavedItem: nutrition.deleteSavedItem,

  // Meal plans (recipes and items)
  findMealPlanRecipeByExternalId: mealPlans.findMealPlanRecipeByExternalId,
  getMealPlanRecipe: mealPlans.getMealPlanRecipe,
  getMealPlanRecipeWithIngredients: mealPlans.getMealPlanRecipeWithIngredients,
  getUserMealPlanRecipes: mealPlans.getUserMealPlanRecipes,
  createMealPlanRecipe: mealPlans.createMealPlanRecipe,
  createMealPlanFromSuggestions: mealPlans.createMealPlanFromSuggestions,
  updateMealPlanRecipe: mealPlans.updateMealPlanRecipe,
  deleteMealPlanRecipe: mealPlans.deleteMealPlanRecipe,
  getUnifiedRecipes: mealPlans.getUnifiedRecipes,
  getMealPlanItems: mealPlans.getMealPlanItems,
  getMealPlanItemById: mealPlans.getMealPlanItemById,
  addMealPlanItem: mealPlans.addMealPlanItem,
  removeMealPlanItem: mealPlans.removeMealPlanItem,
  reorderMealPlanItems: mealPlans.reorderMealPlanItems,
  // Grocery lists
  createGroceryList: groceryLists.createGroceryList,
  getGroceryListCount: groceryLists.getGroceryListCount,
  getGroceryLists: groceryLists.getGroceryLists,
  getGroceryListWithItems: groceryLists.getGroceryListWithItems,
  verifyGroceryListOwnership: groceryLists.verifyGroceryListOwnership,
  deleteGroceryList: groceryLists.deleteGroceryList,
  createGroceryListWithLimitCheck: groceryLists.createGroceryListWithLimitCheck,
  addGroceryListItem: groceryLists.addGroceryListItem,
  addGroceryListItems: groceryLists.addGroceryListItems,
  updateGroceryListItemChecked: groceryLists.updateGroceryListItemChecked,
  deleteGroceryListItem: groceryLists.deleteGroceryListItem,
  updateGroceryListItemPantryFlag: groceryLists.updateGroceryListItemPantryFlag,

  // Pantry
  getPantryItems: pantry.getPantryItems,
  getPantryItem: pantry.getPantryItem,
  getPantryItemCount: pantry.getPantryItemCount,
  createPantryItem: pantry.createPantryItem,
  createPantryItems: pantry.createPantryItems,
  addGroceryItemToPantryAtomically: pantry.addGroceryItemToPantryAtomically,
  updatePantryItem: pantry.updatePantryItem,
  deletePantryItem: pantry.deletePantryItem,
  getExpiringPantryItems: pantry.getExpiringPantryItems,
  getConfirmedMealPlanItemIds: mealPlans.getConfirmedMealPlanItemIds,
  getPlannedNutritionSummary: mealPlans.getPlannedNutritionSummary,
  getMealPlanIngredientsForDateRange:
    mealPlans.getMealPlanIngredientsForDateRange,
  getFrequentRecipesForMealType: mealPlans.getFrequentRecipesForMealType,
  getPopularPicksByMealType: mealPlans.getPopularPicksByMealType,
  getRecipesWithEmptyMealTypes: mealPlans.getRecipesWithEmptyMealTypes,
  batchUpdateMealTypes: mealPlans.batchUpdateMealTypes,
  getAllMealPlanRecipes: mealPlans.getAllMealPlanRecipes,
  getAllRecipeIngredients: mealPlans.getAllRecipeIngredients,

  // Weight & HealthKit
  getWeightLogs: health.getWeightLogs,
  createWeightLog: health.createWeightLog,
  createWeightLogAndUpdateUser: health.createWeightLogAndUpdateUser,
  deleteWeightLog: health.deleteWeightLog,
  getLatestWeight: health.getLatestWeight,
  getHealthKitSyncSettings: health.getHealthKitSyncSettings,
  upsertHealthKitSyncSetting: health.upsertHealthKitSyncSetting,
  updateHealthKitLastSync: health.updateHealthKitLastSync,

  // Chat
  getChatConversation: chat.getChatConversation,
  getChatConversations: chat.getChatConversations,
  createChatConversation: chat.createChatConversation,
  getChatMessages: chat.getChatMessages,
  getChatMessageById: chat.getChatMessageById,
  createChatMessage: chat.createChatMessage,
  deleteChatConversation: chat.deleteChatConversation,
  deleteChatMessage: chat.deleteChatMessage,
  updateChatConversationTitle: chat.updateChatConversationTitle,
  pinChatConversation: chat.pinChatConversation,
  getDailyChatMessageCount: chat.getDailyChatMessageCount,
  createChatMessageWithLimitCheck: chat.createChatMessageWithLimitCheck,
  saveRecipeFromChat: recipeFromChat.saveRecipeFromChat,
  getCoachCachedResponse: chat.getCoachCachedResponse,
  setCoachCachedResponse: chat.setCoachCachedResponse,

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
  createMealSuggestionCacheWithLimitCheck:
    cache.createMealSuggestionCacheWithLimitCheck,
  incrementMealSuggestionCacheHit: cache.incrementMealSuggestionCacheHit,
  getDailyMealSuggestionCount: cache.getDailyMealSuggestionCount,
  getMicronutrientCache: cache.getMicronutrientCache,
  setMicronutrientCache: cache.setMicronutrientCache,
  getNutritionCacheBatch: cache.getNutritionCacheBatch,
  setNutritionCache: cache.setNutritionCache,
  setNutritionCacheIfAbsent: cache.setNutritionCacheIfAbsent,

  // Community recipes
  getDailyRecipeGenerationCount: community.getDailyRecipeGenerationCount,
  logRecipeGeneration: community.logRecipeGeneration,
  logRecipeGenerationWithLimitCheck:
    community.logRecipeGenerationWithLimitCheck,
  getCommunityRecipes: community.getCommunityRecipes,
  createCommunityRecipe: community.createCommunityRecipe,
  createRecipeWithLimitCheck: community.createRecipeWithLimitCheck,
  updateRecipePublicStatus: community.updateRecipePublicStatus,
  updateCommunityRecipeImageUrl: community.updateCommunityRecipeImageUrl,
  getCommunityRecipe: community.getCommunityRecipe,
  getFeaturedRecipes: community.getFeaturedRecipes,
  getAllPublicCommunityRecipes: community.getAllPublicCommunityRecipes,
  getCommunityRecipesWithEmptyMealTypes:
    community.getCommunityRecipesWithEmptyMealTypes,
  batchUpdateCommunityMealTypes: community.batchUpdateCommunityMealTypes,
  deleteCommunityRecipe: community.deleteCommunityRecipe,
  getUserRecipes: community.getUserRecipes,

  // Medication & goal adjustment logs
  getMedicationLogs: medication.getMedicationLogs,
  createMedicationLog: medication.createMedicationLog,
  updateMedicationLog: medication.updateMedicationLog,
  deleteMedicationLog: medication.deleteMedicationLog,
  createGoalAdjustmentLog: medication.createGoalAdjustmentLog,
  applyAdaptiveGoalsAtomically: medication.applyAdaptiveGoalsAtomically,
  dismissAdaptiveGoalsAtomically: medication.dismissAdaptiveGoalsAtomically,
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

  // Receipt scans
  createReceiptScan: receipt.createReceiptScan,
  getMonthlyReceiptScanCount: receipt.getMonthlyReceiptScanCount,

  // Cookbooks
  createCookbook: cookbooksStorage.createCookbook,
  getUserCookbooks: cookbooksStorage.getUserCookbooks,
  getCookbook: cookbooksStorage.getCookbook,
  updateCookbook: cookbooksStorage.updateCookbook,
  deleteCookbook: cookbooksStorage.deleteCookbook,
  addRecipeToCookbook: cookbooksStorage.addRecipeToCookbook,
  removeRecipeFromCookbook: cookbooksStorage.removeRecipeFromCookbook,
  getCookbookRecipes: cookbooksStorage.getCookbookRecipes,
  getResolvedCookbookRecipes: cookbooksStorage.getResolvedCookbookRecipes,

  // Favourite recipes
  toggleFavouriteRecipe: favouriteRecipesStorage.toggleFavouriteRecipe,
  getUserFavouriteRecipeIds: favouriteRecipesStorage.getUserFavouriteRecipeIds,
  isRecipeFavourited: favouriteRecipesStorage.isRecipeFavourited,
  getFavouriteRecipeCount: favouriteRecipesStorage.getFavouriteRecipeCount,
  getResolvedFavouriteRecipes:
    favouriteRecipesStorage.getResolvedFavouriteRecipes,
  getRecipeSharePayload: community.getRecipeSharePayload,

  // Public API (API keys + barcode nutrition)
  createApiKey: apiKeysStorage.createApiKey,
  getApiKeyByPrefix: apiKeysStorage.getApiKeyByPrefix,
  getApiKey: apiKeysStorage.getApiKey,
  revokeApiKey: apiKeysStorage.revokeApiKey,
  updateApiKeyTier: apiKeysStorage.updateApiKeyTier,
  listApiKeys: apiKeysStorage.listApiKeys,
  incrementApiKeyUsage: apiKeysStorage.incrementUsage,
  getApiKeyUsage: apiKeysStorage.getUsage,
  getApiKeyUsageStats: apiKeysStorage.getUsageStats,
  upsertBarcodeNutrition: apiKeysStorage.upsertBarcodeNutrition,
  getBarcodeNutrition: apiKeysStorage.getBarcodeNutrition,

  // Batch scan
  batchCreateScannedItemsWithLogs: batch.batchCreateScannedItemsWithLogs,
  batchCreatePantryItems: batch.batchCreatePantryItems,
  batchCreateGroceryItems: batch.batchCreateGroceryItems,

  // Barcode verification
  getVerification: verification.getVerification,
  getVerificationByBarcodes: verification.getVerificationByBarcodes,
  getVerificationHistory: verification.getVerificationHistory,
  hasUserVerified: verification.hasUserVerified,
  getUserVerificationStats: verification.getUserVerificationStats,
  submitVerification: verification.submitVerification,
  hasUserFrontLabelScanned: verification.hasUserFrontLabelScanned,
  confirmFrontLabelData: verification.confirmFrontLabelData,
  getUserCompositeScore: verification.getUserCompositeScore,

  // Reformulation detection
  getReformulationFlag: reformulation.getReformulationFlag,
  getReformulationFlags: reformulation.getReformulationFlags,
  flagReformulation: reformulation.flagReformulation,
  resolveReformulationFlag: reformulation.resolveReformulationFlag,
  getReformulationFlagCount: reformulation.getReformulationFlagCount,

  // Sessions (in-memory photo analysis workflow state)
  canCreateAnalysisSession: sessions.canCreateAnalysisSession,
  createAnalysisSessionIfAllowed: sessions.createAnalysisSessionIfAllowed,
  createAnalysisSession: sessions.createAnalysisSession,
  getAnalysisSession: sessions.getAnalysisSession,
  updateAnalysisSession: sessions.updateAnalysisSession,
  clearAnalysisSession: sessions.clearAnalysisSession,
  canCreateLabelSession: sessions.canCreateLabelSession,
  createLabelSessionIfAllowed: sessions.createLabelSessionIfAllowed,
  createLabelSession: sessions.createLabelSession,
  getLabelSession: sessions.getLabelSession,
  clearLabelSession: sessions.clearLabelSession,
  cookingSessionStore: sessions.cookingSessionStore,
  frontLabelSessionStore: sessions.frontLabelSessionStore,

  // Carousel (recipe discovery)
  getDismissedRecipeIds: carousel.getDismissedRecipeIds,
  dismissRecipe: carousel.dismissRecipe,
  getRecentCommunityRecipes: carousel.getRecentCommunityRecipes,

  // Profile hub (aggregated counts)
  getLibraryCounts: profileHub.getLibraryCounts,

  // Coach Notebook
  getActiveNotebookEntries: coachNotebook.getActiveNotebookEntries,
  createNotebookEntry: coachNotebook.createNotebookEntry,
  createNotebookEntries: coachNotebook.createNotebookEntries,
  updateNotebookEntryStatus: coachNotebook.updateNotebookEntryStatus,
  getCommitmentsWithDueFollowUp: coachNotebook.getCommitmentsWithDueFollowUp,
  archiveOldEntries: coachNotebook.archiveOldEntries,
  getNotebookEntryCount: coachNotebook.getNotebookEntryCount,
  getNotebookEntries: coachNotebook.getNotebookEntries,
  updateNotebookEntry: coachNotebook.updateNotebookEntry,
  deleteNotebookEntry: coachNotebook.deleteNotebookEntry,
};
