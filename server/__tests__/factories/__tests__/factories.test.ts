import { describe, it, expect } from "vitest";
import * as factories from "../index";
import {
  createMockUser,
  createMockUserProfile,
  createMockScannedItem,
  createMockDailyLog,
  createMockNutritionCache,
  createMockMicronutrientCache,
  createMockFavouriteScannedItem,
  createMockNutritionData,
  createMockCookedNutrition,
  createMockChatCompletion,
  createMockMealPlanRecipe,
  createMockRecipeIngredient,
  createMockMealPlanItem,
  createMockCommunityRecipe,
  createMockRecipeGenerationLog,
  createMockCookbook,
  createMockCookbookRecipe,
  createMockTastePick,
  createMockRecipeDismissal,
  createMockGroceryList,
  createMockGroceryListItem,
  createMockPantryItem,
  createMockChatConversation,
  createMockChatMessage,
  createMockCoachNotebookEntry,
  createMockWeightLog,
  createMockHealthKitSync,
  createMockFastingSchedule,
  createMockFastingLog,
  createMockTransaction,
  createMockMenuScan,
  createMockReceiptScan,
  createMockBarcodeVerification,
  createMockVerificationHistory,
  createMockReformulationFlag,
  createMockApiKey,
  createMockApiKeyUsage,
  createMockBarcodeNutrition,
  createMockSuggestionCache,
  createMockInstructionCache,
  createMockMealSuggestionCache,
  createMockCoachResponseCache,
  createMockCarouselSuggestionCache,
  createMockSavedItem,
  createMockFavouriteRecipe,
  createMockResolvedFavouriteRecipe,
  createMockPendingReminder,
  createMockPushToken,
} from "../index";

describe("factories/index exports", () => {
  it("every export name starts with createMock", () => {
    const exportNames = Object.keys(factories);
    expect(exportNames.length).toBeGreaterThan(0);
    for (const name of exportNames) {
      expect(name).toMatch(/^createMock/);
    }
  });
});

describe("factories/user", () => {
  describe("createMockUser", () => {
    it("creates valid defaults", () => {
      const obj = createMockUser();
      expect(obj).toMatchObject({ id: "1", username: "testuser" });
      expect(obj.password).not.toBeUndefined();
      expect(obj.password).not.toBeNull();
      expect(obj.subscriptionTier).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockUser({ id: "99", username: "alice" });
      expect(obj.id).toBe("99");
      expect(obj.username).toBe("alice");
    });
  });

  describe("createMockUserProfile", () => {
    it("creates valid defaults", () => {
      const obj = createMockUserProfile();
      expect(obj).toMatchObject({ id: 1, userId: "1", householdSize: 1 });
      expect(obj.allergies).not.toBeNull();
      expect(obj.healthConditions).not.toBeNull();
      expect(obj.foodDislikes).not.toBeNull();
      expect(obj.cuisinePreferences).not.toBeNull();
      expect(obj.reminderMutes).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockUserProfile({ id: 99, householdSize: 4 });
      expect(obj.id).toBe(99);
      expect(obj.householdSize).toBe(4);
    });
  });
});

describe("factories/nutrition", () => {
  describe("createMockScannedItem", () => {
    it("creates valid defaults", () => {
      const obj = createMockScannedItem();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        productName: "Test Product",
      });
      expect(obj.calories).not.toBeNull();
      expect(obj.sourceType).not.toBeNull();
      expect(obj.scannedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockScannedItem({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockDailyLog", () => {
    it("creates valid defaults", () => {
      const obj = createMockDailyLog();
      expect(obj).toMatchObject({ id: 1, userId: "1", source: "scan" });
      expect(obj.servings).not.toBeNull();
      expect(obj.loggedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockDailyLog({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockNutritionCache", () => {
    it("creates valid defaults", () => {
      const obj = createMockNutritionCache();
      expect(obj).toMatchObject({
        id: 1,
        queryKey: "test-key",
        source: "usda",
      });
      expect(obj.data).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.expiresAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockNutritionCache({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockMicronutrientCache", () => {
    it("creates valid defaults", () => {
      const obj = createMockMicronutrientCache();
      expect(obj).toMatchObject({ id: 1, queryKey: "test-key" });
      expect(obj.data).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.expiresAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockMicronutrientCache({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockFavouriteScannedItem", () => {
    it("creates valid defaults", () => {
      const obj = createMockFavouriteScannedItem();
      expect(obj).toMatchObject({ id: 1, userId: "1", scannedItemId: 1 });
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockFavouriteScannedItem({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockNutritionData", () => {
    it("creates valid defaults", () => {
      const obj = createMockNutritionData();
      expect(obj).toMatchObject({ name: "test food", source: "usda" });
      expect(obj.calories).not.toBeNull();
      expect(obj.protein).not.toBeNull();
      expect(obj.carbs).not.toBeNull();
      expect(obj.fat).not.toBeNull();
    });

    it("merges overrides", () => {
      const obj = createMockNutritionData({ name: "kale", calories: 35 });
      expect(obj.name).toBe("kale");
      expect(obj.calories).toBe(35);
    });
  });

  describe("createMockCookedNutrition", () => {
    it("creates valid defaults", () => {
      const obj = createMockCookedNutrition();
      expect(obj).toMatchObject({
        cookingMethod: "grilled",
        adjustmentApplied: true,
      });
      expect(obj.calories).not.toBeNull();
      expect(obj.cookedWeightG).not.toBeNull();
    });

    it("merges overrides", () => {
      const obj = createMockCookedNutrition({ cookingMethod: "baked" });
      expect(obj.cookingMethod).toBe("baked");
    });
  });

  describe("createMockChatCompletion", () => {
    // Different signature: takes (content) instead of (overrides). Verify shape only.
    it("creates valid defaults with content", () => {
      const obj = createMockChatCompletion("hello world");
      expect(obj).toMatchObject({
        id: "chatcmpl-test",
        object: "chat.completion",
        model: "gpt-4o",
      });
      expect(obj.choices[0].message.content).toBe("hello world");
      expect(obj.choices[0].finish_reason).toBe("stop");
      expect(obj.usage).not.toBeNull();
    });

    it("accepts null content", () => {
      const obj = createMockChatCompletion(null);
      expect(obj.choices[0].message.content).toBeNull();
    });
  });
});

describe("factories/recipes", () => {
  describe("createMockMealPlanRecipe", () => {
    it("creates valid defaults", () => {
      const obj = createMockMealPlanRecipe();
      expect(obj).toMatchObject({ id: 1, userId: "1", title: "Test Recipe" });
      expect(obj.instructions).not.toBeNull();
      expect(obj.dietTags).not.toBeNull();
      expect(obj.mealTypes).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockMealPlanRecipe({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockRecipeIngredient", () => {
    it("creates valid defaults", () => {
      const obj = createMockRecipeIngredient();
      expect(obj).toMatchObject({
        id: 1,
        recipeId: 1,
        name: "Test Ingredient",
      });
      expect(obj.quantity).not.toBeNull();
      expect(obj.unit).not.toBeNull();
      expect(obj.category).not.toBeNull();
    });

    it("merges overrides", () => {
      const obj = createMockRecipeIngredient({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockMealPlanItem", () => {
    it("creates valid defaults", () => {
      const obj = createMockMealPlanItem();
      expect(obj).toMatchObject({ id: 1, userId: "1", mealType: "lunch" });
      expect(obj.plannedDate).not.toBeNull();
      expect(obj.servings).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockMealPlanItem({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockCommunityRecipe", () => {
    it("creates valid defaults", () => {
      const obj = createMockCommunityRecipe();
      expect(obj).toMatchObject({ id: 1, authorId: "1", isPublic: true });
      expect(obj.instructions).not.toBeNull();
      expect(obj.ingredients).not.toBeNull();
      expect(obj.dietTags).not.toBeNull();
      expect(obj.mealTypes).not.toBeNull();
      expect(obj.canonicalImages).not.toBeNull();
      expect(obj.instructionDetails).not.toBeNull();
      expect(obj.toolsRequired).not.toBeNull();
      expect(obj.chefTips).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockCommunityRecipe({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockRecipeGenerationLog", () => {
    it("creates valid defaults", () => {
      const obj = createMockRecipeGenerationLog();
      expect(obj).toMatchObject({ id: 1, userId: "1" });
      expect(obj.generatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockRecipeGenerationLog({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockCookbook", () => {
    it("creates valid defaults", () => {
      const obj = createMockCookbook();
      expect(obj).toMatchObject({ id: 1, userId: "1", name: "Test Cookbook" });
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockCookbook({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockCookbookRecipe", () => {
    it("creates valid defaults", () => {
      const obj = createMockCookbookRecipe();
      expect(obj).toMatchObject({
        id: 1,
        cookbookId: 1,
        recipeId: 1,
        recipeType: "mealPlan",
      });
      expect(obj.addedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockCookbookRecipe({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockTastePick", () => {
    it("creates valid defaults", () => {
      const obj = createMockTastePick();
      expect(obj).toMatchObject({ id: 1, userId: "1", recipeId: 1 });
      expect(obj.pickedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockTastePick({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockRecipeDismissal", () => {
    it("creates valid defaults", () => {
      const obj = createMockRecipeDismissal();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        recipeIdentifier: "1",
        source: "carousel",
      });
      expect(obj.dismissedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockRecipeDismissal({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/grocery", () => {
  describe("createMockGroceryList", () => {
    it("creates valid defaults", () => {
      const obj = createMockGroceryList();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        title: "Test Grocery List",
      });
      expect(obj.dateRangeStart).not.toBeNull();
      expect(obj.dateRangeEnd).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockGroceryList({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockGroceryListItem", () => {
    it("creates valid defaults", () => {
      const obj = createMockGroceryListItem();
      expect(obj).toMatchObject({
        id: 1,
        groceryListId: 1,
        name: "Test Item",
        isChecked: false,
      });
      expect(obj.quantity).not.toBeNull();
      expect(obj.category).not.toBeNull();
    });

    it("merges overrides", () => {
      const obj = createMockGroceryListItem({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockPantryItem", () => {
    it("creates valid defaults", () => {
      const obj = createMockPantryItem();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        name: "Test Pantry Item",
      });
      expect(obj.quantity).not.toBeNull();
      expect(obj.category).not.toBeNull();
      expect(obj.addedAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockPantryItem({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/chat", () => {
  describe("createMockChatConversation", () => {
    it("creates valid defaults", () => {
      const obj = createMockChatConversation();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        title: "Test Conversation",
        type: "coach",
        isPinned: false,
      });
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockChatConversation({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockChatMessage", () => {
    it("creates valid defaults", () => {
      const obj = createMockChatMessage();
      expect(obj).toMatchObject({
        id: 1,
        conversationId: 1,
        role: "user",
        content: "Test message",
      });
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockChatMessage({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockCoachNotebookEntry", () => {
    it("creates valid defaults", () => {
      const obj = createMockCoachNotebookEntry();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        type: "observation",
        status: "active",
      });
      expect(obj.content).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockCoachNotebookEntry({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/health", () => {
  describe("createMockWeightLog", () => {
    it("creates valid defaults", () => {
      const obj = createMockWeightLog();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        unit: "kg",
        source: "manual",
      });
      expect(obj.weight).not.toBeNull();
      expect(obj.loggedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockWeightLog({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockHealthKitSync", () => {
    it("creates valid defaults", () => {
      const obj = createMockHealthKitSync();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        dataType: "weight",
        enabled: false,
        syncDirection: "read",
      });
    });

    it("merges overrides", () => {
      const obj = createMockHealthKitSync({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockFastingSchedule", () => {
    it("creates valid defaults", () => {
      const obj = createMockFastingSchedule();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        protocol: "16:8",
        isActive: true,
      });
      expect(obj.eatingWindowStart).not.toBeNull();
      expect(obj.eatingWindowEnd).not.toBeNull();
    });

    it("merges overrides", () => {
      const obj = createMockFastingSchedule({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockFastingLog", () => {
    it("creates valid defaults", () => {
      const obj = createMockFastingLog();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        targetDurationHours: 16,
      });
      expect(obj.startedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockFastingLog({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/subscription", () => {
  describe("createMockTransaction", () => {
    it("creates valid defaults", () => {
      const obj = createMockTransaction();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        transactionId: "txn_test_123",
        platform: "ios",
        status: "pending",
      });
      expect(obj.receipt).not.toBeNull();
      expect(obj.productId).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockTransaction({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/scan", () => {
  describe("createMockMenuScan", () => {
    it("creates valid defaults", () => {
      const obj = createMockMenuScan();
      expect(obj).toMatchObject({ id: 1, userId: "1" });
      expect(obj.menuItems).not.toBeNull();
      expect(obj.scannedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockMenuScan({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockReceiptScan", () => {
    it("creates valid defaults", () => {
      const obj = createMockReceiptScan();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        status: "completed",
      });
      expect(obj.scannedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockReceiptScan({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/verification", () => {
  describe("createMockBarcodeVerification", () => {
    it("creates valid defaults", () => {
      const obj = createMockBarcodeVerification();
      expect(obj).toMatchObject({
        id: 1,
        barcode: "0123456789",
        verificationLevel: "unverified",
      });
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockBarcodeVerification({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockVerificationHistory", () => {
    it("creates valid defaults", () => {
      const obj = createMockVerificationHistory();
      expect(obj).toMatchObject({
        id: 1,
        barcode: "0123456789",
        userId: "1",
        frontLabelScanned: false,
      });
      expect(obj.extractedNutrition).not.toBeNull();
      expect(obj.ocrConfidence).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockVerificationHistory({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockReformulationFlag", () => {
    it("creates valid defaults", () => {
      const obj = createMockReformulationFlag();
      expect(obj).toMatchObject({
        id: 1,
        barcode: "0123456789",
        status: "flagged",
      });
      expect(obj.detectedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockReformulationFlag({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockApiKey", () => {
    it("creates valid defaults", () => {
      const obj = createMockApiKey();
      expect(obj).toMatchObject({
        id: 1,
        tier: "free",
        status: "active",
        ownerId: "1",
      });
      expect(obj.keyPrefix).not.toBeNull();
      expect(obj.keyHash).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockApiKey({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockApiKeyUsage", () => {
    it("creates valid defaults", () => {
      const obj = createMockApiKeyUsage();
      expect(obj).toMatchObject({
        id: 1,
        apiKeyId: 1,
        yearMonth: "2024-01",
        requestCount: 0,
      });
    });

    it("merges overrides", () => {
      const obj = createMockApiKeyUsage({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockBarcodeNutrition", () => {
    it("creates valid defaults", () => {
      const obj = createMockBarcodeNutrition();
      expect(obj).toMatchObject({
        id: 1,
        barcode: "0123456789",
        source: "usda",
      });
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockBarcodeNutrition({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/cache", () => {
  describe("createMockSuggestionCache", () => {
    it("creates valid defaults", () => {
      const obj = createMockSuggestionCache();
      expect(obj).toMatchObject({
        id: 1,
        scannedItemId: 1,
        userId: "1",
        profileHash: "abc123",
      });
      expect(obj.suggestions).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.expiresAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockSuggestionCache({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockInstructionCache", () => {
    it("creates valid defaults", () => {
      const obj = createMockInstructionCache();
      expect(obj).toMatchObject({
        id: 1,
        suggestionCacheId: 1,
        suggestionIndex: 0,
        suggestionType: "recipe",
      });
      expect(obj.instructions).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockInstructionCache({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockMealSuggestionCache", () => {
    it("creates valid defaults", () => {
      const obj = createMockMealSuggestionCache();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        cacheKey: "test-cache-key",
      });
      expect(obj.suggestions).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.expiresAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockMealSuggestionCache({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockCoachResponseCache", () => {
    it("creates valid defaults", () => {
      const obj = createMockCoachResponseCache();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        question: "Test question",
        response: "Test response",
      });
      expect(obj.questionHash).not.toBeNull();
      expect(obj.questionHash.length).toBe(64);
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.expiresAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockCoachResponseCache({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockCarouselSuggestionCache", () => {
    it("creates valid defaults", () => {
      const obj = createMockCarouselSuggestionCache();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        profileHash: "test-profile-hash",
        mealType: "breakfast",
      });
      expect(obj.suggestions).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.expiresAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockCarouselSuggestionCache({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/saved-item", () => {
  describe("createMockSavedItem", () => {
    it("creates valid defaults", () => {
      const obj = createMockSavedItem();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        type: "recipe",
        title: "Test Saved Item",
      });
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockSavedItem({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});

describe("factories/favourite-recipes", () => {
  describe("createMockFavouriteRecipe", () => {
    it("creates valid defaults", () => {
      const obj = createMockFavouriteRecipe();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        recipeId: 1,
        recipeType: "mealPlan",
      });
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockFavouriteRecipe({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockResolvedFavouriteRecipe", () => {
    // No `id` field — uses `recipeId`. `favouritedAt` is an ISO string, NOT a Date.
    it("creates valid defaults", () => {
      const obj = createMockResolvedFavouriteRecipe();
      expect(obj).toMatchObject({
        recipeId: 1,
        recipeType: "mealPlan",
        title: "Test Recipe",
        servings: 2,
      });
      expect(typeof obj.favouritedAt).toBe("string");
      expect(obj.favouritedAt).not.toBeNull();
    });

    it("merges overrides", () => {
      const obj = createMockResolvedFavouriteRecipe({ recipeId: 99 });
      expect(obj.recipeId).toBe(99);
    });
  });
});

describe("factories/reminders", () => {
  describe("createMockPendingReminder", () => {
    it("creates valid defaults", () => {
      const obj = createMockPendingReminder();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        type: "daily-checkin",
      });
      expect(obj.context).not.toBeNull();
      expect(obj.scheduledFor).toBeInstanceOf(Date);
      expect(obj.createdAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockPendingReminder({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });

  describe("createMockPushToken", () => {
    it("creates valid defaults", () => {
      const obj = createMockPushToken();
      expect(obj).toMatchObject({
        id: 1,
        userId: "1",
        platform: "ios",
      });
      expect(obj.token).not.toBeNull();
      expect(obj.createdAt).toBeInstanceOf(Date);
      expect(obj.updatedAt).toBeInstanceOf(Date);
    });

    it("merges overrides", () => {
      const obj = createMockPushToken({ id: 99 });
      expect(obj.id).toBe(99);
    });
  });
});
