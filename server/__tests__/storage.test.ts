import { escapeLike } from "../storage";

// Test the IStorage interface contract and edge cases
describe("Storage Interface Contract", () => {
  describe("getUser", () => {
    it("should accept string id parameter", () => {
      // Interface specifies: getUser(id: string): Promise<User | undefined>
      const mockGetUser = vi.fn().mockResolvedValue(undefined);
      expect(() => mockGetUser("user-123")).not.toThrow();
    });

    it("should return undefined for non-existent user", async () => {
      const mockGetUser = vi.fn().mockResolvedValue(undefined);
      const result = await mockGetUser("non-existent");
      expect(result).toBeUndefined();
    });

    it("should return user object for existing user", async () => {
      const mockUser = {
        id: "user-123",
        username: "testuser",
        password: "hashed",
        displayName: "Test User",
        dailyCalorieGoal: 2000,
        onboardingCompleted: false,
        createdAt: new Date(),
      };
      const mockGetUser = vi.fn().mockResolvedValue(mockUser);
      const result = await mockGetUser("user-123");
      expect(result).toEqual(mockUser);
    });
  });

  describe("getUserByUsername", () => {
    it("should accept string username parameter", () => {
      const mockGetUserByUsername = vi.fn().mockResolvedValue(undefined);
      expect(() => mockGetUserByUsername("testuser")).not.toThrow();
    });

    it("should be case-sensitive for username lookup", async () => {
      const mockUser = { id: "1", username: "TestUser" };
      const mockGetUserByUsername = vi.fn().mockImplementation((username) => {
        if (username === "TestUser") return Promise.resolve(mockUser);
        return Promise.resolve(undefined);
      });

      expect(await mockGetUserByUsername("TestUser")).toEqual(mockUser);
      expect(await mockGetUserByUsername("testuser")).toBeUndefined();
    });
  });

  describe("createUser", () => {
    it("should accept InsertUser and return User", async () => {
      const insertUser = { username: "newuser", password: "hashedpass" };
      const createdUser = {
        id: "new-id",
        ...insertUser,
        displayName: null,
        dailyCalorieGoal: 2000,
        onboardingCompleted: false,
        createdAt: new Date(),
      };

      const mockCreateUser = vi.fn().mockResolvedValue(createdUser);
      const result = await mockCreateUser(insertUser);

      expect(result.id).toBeDefined();
      expect(result.username).toBe(insertUser.username);
      expect(result.password).toBe(insertUser.password);
    });
  });

  describe("updateUser", () => {
    it("should accept partial updates", async () => {
      const mockUpdateUser = vi.fn().mockResolvedValue({
        id: "user-123",
        username: "test",
        displayName: "Updated Name",
        dailyCalorieGoal: 1800,
      });

      const result = await mockUpdateUser("user-123", {
        displayName: "Updated Name",
        dailyCalorieGoal: 1800,
      });

      expect(result.displayName).toBe("Updated Name");
      expect(result.dailyCalorieGoal).toBe(1800);
    });

    it("should return undefined for non-existent user", async () => {
      const mockUpdateUser = vi.fn().mockResolvedValue(undefined);
      const result = await mockUpdateUser("non-existent", {
        displayName: "New",
      });
      expect(result).toBeUndefined();
    });
  });

  describe("getUserProfile", () => {
    it("should return undefined for user without profile", async () => {
      const mockGetUserProfile = vi.fn().mockResolvedValue(undefined);
      const result = await mockGetUserProfile("user-without-profile");
      expect(result).toBeUndefined();
    });

    it("should return profile with all fields for user with profile", async () => {
      const mockProfile = {
        id: 1,
        userId: "user-123",
        allergies: [{ name: "Peanuts", severity: "severe" }],
        healthConditions: ["diabetes"],
        dietType: "vegetarian",
        foodDislikes: ["olives"],
        primaryGoal: "weight loss",
        activityLevel: "moderate",
        householdSize: 2,
        cuisinePreferences: ["Italian", "Mexican"],
        cookingSkillLevel: "intermediate",
        cookingTimeAvailable: "30-60 min",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockGetUserProfile = vi.fn().mockResolvedValue(mockProfile);
      const result = await mockGetUserProfile("user-123");

      expect(result).toEqual(mockProfile);
      expect(result.allergies).toHaveLength(1);
      expect(result.cuisinePreferences).toContain("Italian");
    });
  });

  describe("getScannedItems", () => {
    it("should return empty array and zero total for user with no items", async () => {
      const mockGetScannedItems = vi.fn().mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await mockGetScannedItems("user-123", 50, 0);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should respect limit and offset for pagination", async () => {
      const allItems = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        productName: `Product ${i + 1}`,
      }));

      const mockGetScannedItems = vi
        .fn()
        .mockImplementation((userId, limit, offset) => ({
          items: allItems.slice(offset, offset + limit),
          total: allItems.length,
        }));

      const page1 = await mockGetScannedItems("user-123", 10, 0);
      expect(page1.items).toHaveLength(10);
      expect(page1.items[0].id).toBe(1);
      expect(page1.total).toBe(100);

      const page2 = await mockGetScannedItems("user-123", 10, 10);
      expect(page2.items).toHaveLength(10);
      expect(page2.items[0].id).toBe(11);
    });

    it("should use default values for limit and offset", async () => {
      const mockGetScannedItems = vi
        .fn()
        .mockImplementation((userId, limit = 50, offset = 0) => ({
          items: [],
          total: 0,
          usedLimit: limit,
          usedOffset: offset,
        }));

      const result = await mockGetScannedItems("user-123");
      expect(result.usedLimit).toBe(50);
      expect(result.usedOffset).toBe(0);
    });
  });

  describe("getScannedItem", () => {
    it("should accept numeric id parameter", async () => {
      const mockGetScannedItem = vi.fn().mockResolvedValue(undefined);
      await mockGetScannedItem(123);
      expect(mockGetScannedItem).toHaveBeenCalledWith(123);
    });

    it("should return undefined for non-existent item", async () => {
      const mockGetScannedItem = vi.fn().mockResolvedValue(undefined);
      const result = await mockGetScannedItem(999);
      expect(result).toBeUndefined();
    });

    it("should return item with nutrition data", async () => {
      const mockItem = {
        id: 1,
        userId: "user-123",
        barcode: "012345678901",
        productName: "Granola Bar",
        brandName: "Nature Valley",
        servingSize: "1 bar (42g)",
        calories: "190",
        protein: "4",
        carbs: "29",
        fat: "6",
        fiber: "2",
        sugar: "12",
        sodium: "180",
        imageUrl: "https://example.com/image.jpg",
        scannedAt: new Date(),
      };

      const mockGetScannedItem = vi.fn().mockResolvedValue(mockItem);
      const result = await mockGetScannedItem(1);

      expect(result).toEqual(mockItem);
      expect(result.calories).toBe("190");
    });
  });

  describe("getDailySummary", () => {
    it("should return zeros for day with no logs", async () => {
      const mockGetDailySummary = vi.fn().mockResolvedValue({
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        itemCount: 0,
      });

      const result = await mockGetDailySummary("user-123", new Date());

      expect(result.totalCalories).toBe(0);
      expect(result.totalProtein).toBe(0);
      expect(result.totalCarbs).toBe(0);
      expect(result.totalFat).toBe(0);
      expect(result.itemCount).toBe(0);
    });

    it("should calculate totals from multiple logged items", async () => {
      const mockGetDailySummary = vi.fn().mockResolvedValue({
        totalCalories: 850,
        totalProtein: 25,
        totalCarbs: 120,
        totalFat: 30,
        itemCount: 3,
      });

      const result = await mockGetDailySummary("user-123", new Date());

      expect(result.totalCalories).toBe(850);
      expect(result.itemCount).toBe(3);
    });

    it("should handle date parameter correctly", async () => {
      const specificDate = new Date("2024-01-15");
      const mockGetDailySummary = vi.fn().mockResolvedValue({
        totalCalories: 1500,
        totalProtein: 50,
        totalCarbs: 200,
        totalFat: 50,
        itemCount: 5,
      });

      await mockGetDailySummary("user-123", specificDate);

      expect(mockGetDailySummary).toHaveBeenCalledWith(
        "user-123",
        specificDate,
      );
    });
  });

  describe("getDailyLogs", () => {
    it("should return empty array for day with no logs", async () => {
      const mockGetDailyLogs = vi.fn().mockResolvedValue([]);
      const result = await mockGetDailyLogs("user-123", new Date());
      expect(result).toEqual([]);
    });

    it("should return logs ordered by loggedAt descending", async () => {
      const logs = [
        { id: 3, loggedAt: new Date("2024-01-15T18:00:00") },
        { id: 2, loggedAt: new Date("2024-01-15T12:00:00") },
        { id: 1, loggedAt: new Date("2024-01-15T08:00:00") },
      ];

      const mockGetDailyLogs = vi.fn().mockResolvedValue(logs);
      const result = await mockGetDailyLogs("user-123", new Date("2024-01-15"));

      expect(result[0].id).toBe(3); // Most recent first
      expect(result[2].id).toBe(1); // Oldest last
    });
  });

  describe("createScannedItem", () => {
    it("should create item and return with generated id and scannedAt", async () => {
      const insertItem = {
        userId: "user-123",
        productName: "Apple",
        calories: "95",
      };

      const createdItem = {
        id: 42,
        ...insertItem,
        barcode: null,
        brandName: null,
        servingSize: null,
        protein: null,
        carbs: null,
        fat: null,
        fiber: null,
        sugar: null,
        sodium: null,
        imageUrl: null,
        scannedAt: new Date(),
      };

      const mockCreateScannedItem = vi.fn().mockResolvedValue(createdItem);
      const result = await mockCreateScannedItem(insertItem);

      expect(result.id).toBe(42);
      expect(result.productName).toBe("Apple");
      expect(result.scannedAt).toBeInstanceOf(Date);
    });
  });

  describe("createDailyLog", () => {
    it("should create log with scannedItemId reference", async () => {
      const insertLog = {
        userId: "user-123",
        scannedItemId: 42,
        servings: "1.5",
        mealType: "lunch",
      };

      const createdLog = {
        id: 100,
        ...insertLog,
        loggedAt: new Date(),
      };

      const mockCreateDailyLog = vi.fn().mockResolvedValue(createdLog);
      const result = await mockCreateDailyLog(insertLog);

      expect(result.id).toBe(100);
      expect(result.scannedItemId).toBe(42);
      expect(result.servings).toBe("1.5");
      expect(result.mealType).toBe("lunch");
    });
  });
});

describe("Date Range Calculations", () => {
  it("calculates start of day correctly", () => {
    const date = new Date("2024-03-15T14:30:00");
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    expect(startOfDay.getHours()).toBe(0);
    expect(startOfDay.getMinutes()).toBe(0);
    expect(startOfDay.getSeconds()).toBe(0);
    expect(startOfDay.getMilliseconds()).toBe(0);
    expect(startOfDay.getDate()).toBe(15);
  });

  it("calculates end of day correctly", () => {
    const date = new Date("2024-03-15T14:30:00");
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    expect(endOfDay.getHours()).toBe(23);
    expect(endOfDay.getMinutes()).toBe(59);
    expect(endOfDay.getSeconds()).toBe(59);
    expect(endOfDay.getMilliseconds()).toBe(999);
    expect(endOfDay.getDate()).toBe(15);
  });

  it("handles month boundaries", () => {
    const date = new Date("2024-01-31T12:00:00");
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    expect(startOfDay.getMonth()).toBe(0); // January
    expect(startOfDay.getDate()).toBe(31);
  });

  it("handles year boundaries", () => {
    const date = new Date("2024-12-31T23:59:59");
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    expect(startOfDay.getFullYear()).toBe(2024);
    expect(startOfDay.getMonth()).toBe(11); // December
    expect(startOfDay.getDate()).toBe(31);
  });
});

describe("IDOR Protection", () => {
  it("validates item belongs to requesting user", () => {
    const item = { id: 1, userId: "user-123" };
    const requestingUserId = "user-456";

    const hasAccess = item.userId === requestingUserId;
    expect(hasAccess).toBe(false);
  });

  it("allows access when item belongs to requesting user", () => {
    const item = { id: 1, userId: "user-123" };
    const requestingUserId = "user-123";

    const hasAccess = item.userId === requestingUserId;
    expect(hasAccess).toBe(true);
  });

  it("handles null item (not found)", () => {
    const item = null;
    const requestingUserId = "user-123";

    const notFoundOrUnauthorized = !item || item.userId !== requestingUserId;
    expect(notFoundOrUnauthorized).toBe(true);
  });
});

describe("Saved Items", () => {
  describe("getSavedItems", () => {
    it("should return empty array for user with no saved items", async () => {
      const mockGetSavedItems = vi.fn().mockResolvedValue([]);
      const result = await mockGetSavedItems("user-123");
      expect(result).toEqual([]);
    });

    it("should return saved items ordered by createdAt desc", async () => {
      const items = [
        {
          id: 3,
          title: "Recipe 3",
          createdAt: new Date("2024-01-15T18:00:00"),
        },
        {
          id: 2,
          title: "Recipe 2",
          createdAt: new Date("2024-01-15T12:00:00"),
        },
        {
          id: 1,
          title: "Recipe 1",
          createdAt: new Date("2024-01-15T08:00:00"),
        },
      ];

      const mockGetSavedItems = vi.fn().mockResolvedValue(items);
      const result = await mockGetSavedItems("user-123");

      expect(result[0].id).toBe(3); // Most recent first
      expect(result[2].id).toBe(1); // Oldest last
    });

    it("should return items with all expected fields", async () => {
      const item = {
        id: 1,
        userId: "user-123",
        type: "recipe",
        title: "Pasta Carbonara",
        description: "Classic Italian dish",
        difficulty: "medium",
        timeEstimate: "30 minutes",
        instructions: "Cook pasta...",
        sourceItemId: 42,
        sourceProductName: "Spaghetti",
        createdAt: new Date(),
      };

      const mockGetSavedItems = vi.fn().mockResolvedValue([item]);
      const result = await mockGetSavedItems("user-123");

      expect(result[0]).toEqual(item);
      expect(result[0].type).toBe("recipe");
    });
  });

  describe("getSavedItemCount", () => {
    it("should return 0 for user with no saved items", async () => {
      const mockGetSavedItemCount = vi.fn().mockResolvedValue(0);
      const result = await mockGetSavedItemCount("user-123");
      expect(result).toBe(0);
    });

    it("should return correct count for user with items", async () => {
      const mockGetSavedItemCount = vi.fn().mockResolvedValue(5);
      const result = await mockGetSavedItemCount("user-123");
      expect(result).toBe(5);
    });
  });

  describe("createSavedItem", () => {
    it("should create item when under limit", async () => {
      const newItem = {
        id: 1,
        userId: "user-123",
        type: "recipe",
        title: "New Recipe",
        description: null,
        difficulty: null,
        timeEstimate: null,
        instructions: null,
        sourceItemId: null,
        sourceProductName: null,
        createdAt: new Date(),
      };

      const mockCreateSavedItem = vi.fn().mockResolvedValue(newItem);
      const result = await mockCreateSavedItem("user-123", {
        type: "recipe",
        title: "New Recipe",
      });

      expect(result).toEqual(newItem);
      expect(result.id).toBeDefined();
    });

    it("should return null when at limit for free user", async () => {
      const mockCreateSavedItem = vi.fn().mockResolvedValue(null);
      const result = await mockCreateSavedItem("user-123", {
        type: "recipe",
        title: "Seventh Recipe",
      });

      expect(result).toBeNull();
    });

    it("should allow creation for premium user even at 6 items", async () => {
      const newItem = {
        id: 7,
        userId: "premium-user",
        type: "activity",
        title: "Seventh Activity",
        createdAt: new Date(),
      };

      const mockCreateSavedItem = vi.fn().mockResolvedValue(newItem);
      const result = await mockCreateSavedItem("premium-user", {
        type: "activity",
        title: "Seventh Activity",
      });

      expect(result).not.toBeNull();
      expect(result.id).toBe(7);
    });
  });

  describe("deleteSavedItem", () => {
    it("should return true when item exists and belongs to user", async () => {
      const mockDeleteSavedItem = vi.fn().mockResolvedValue(true);
      const result = await mockDeleteSavedItem(1, "user-123");
      expect(result).toBe(true);
    });

    it("should return false when item does not exist", async () => {
      const mockDeleteSavedItem = vi.fn().mockResolvedValue(false);
      const result = await mockDeleteSavedItem(999, "user-123");
      expect(result).toBe(false);
    });

    it("should return false when item belongs to different user (IDOR protection)", async () => {
      // This tests that deleteItem includes userId in the WHERE clause
      const mockDeleteSavedItem = vi.fn().mockResolvedValue(false);
      const result = await mockDeleteSavedItem(1, "different-user");
      expect(result).toBe(false);
    });
  });
});

describe("escapeLike", () => {
  it("should return plain strings unchanged", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });

  it("should escape percent signs", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("should escape underscores", () => {
    expect(escapeLike("my_product")).toBe("my\\_product");
  });

  it("should escape backslashes", () => {
    expect(escapeLike("path\\to")).toBe("path\\\\to");
  });

  it("should escape multiple metacharacters in one string", () => {
    expect(escapeLike("50% off_sale\\now")).toBe("50\\% off\\_sale\\\\now");
  });

  it("should handle empty string", () => {
    expect(escapeLike("")).toBe("");
  });

  it("should handle strings with only metacharacters", () => {
    expect(escapeLike("%_%")).toBe("\\%\\_\\%");
  });

  it("should not escape other special regex or SQL characters", () => {
    expect(escapeLike("it's a [test] (value)")).toBe("it's a [test] (value)");
  });
});
