import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { SuggestionData } from "@shared/schema";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getSuggestionCache,
  createSuggestionCache,
  incrementSuggestionCacheHit,
  getInstructionCache,
  createInstructionCache,
  incrementInstructionCacheHit,
  invalidateSuggestionCacheForUser,
  getMealSuggestionCache,
  createMealSuggestionCache,
  incrementMealSuggestionCacheHit,
  getDailyMealSuggestionCount,
  getMicronutrientCache,
  setMicronutrientCache,
} = await import("../cache");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestScannedItem(
  tx: NodePgDatabase<typeof schema>,
  userId: string,
) {
  const [item] = await tx
    .insert(schema.scannedItems)
    .values({
      userId,
      productName: "Test Food",
      barcode: "123456",
      calories: "200",
      protein: "10",
      carbs: "25",
      fat: "8",
      servingSize: "100g",
      sourceType: "test",
    })
    .returning();
  return item;
}

function futureDate(hoursFromNow = 24): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

function pastDate(hoursAgo = 24): Date {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
}

const sampleSuggestions: SuggestionData[] = [
  { type: "recipe", title: "Banana Smoothie", description: "Blend with milk" },
  { type: "pairing", title: "With Granola", description: "Crunchy topping" },
];

const sampleMealSuggestion: MealSuggestion = {
  title: "Grilled Chicken Bowl",
  description: "Healthy grilled chicken with veggies",
  reasoning: "High protein, low carb meal",
  calories: 500,
  protein: 40,
  carbs: 30,
  fat: 15,
  prepTimeMinutes: 25,
  difficulty: "Easy",
  ingredients: [
    { name: "Chicken breast", quantity: "200", unit: "g" },
    { name: "Rice", quantity: "100", unit: "g" },
  ],
  instructions: "Grill chicken. Serve with rice.",
  dietTags: ["high-protein"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("cache storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // ==========================================================================
  // SUGGESTION CACHE
  // ==========================================================================

  describe("createSuggestionCache", () => {
    it("creates a cache entry and returns an id", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      const result = await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_abc",
        sampleSuggestions,
        futureDate(),
      );
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("number");
    });
  });

  describe("getSuggestionCache", () => {
    it("returns cached entry when hash matches and not expired", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_match",
        sampleSuggestions,
        futureDate(),
      );

      const cached = await getSuggestionCache(
        item.id,
        testUser.id,
        "hash_match",
      );
      expect(cached).toBeDefined();
      expect(cached!.suggestions).toHaveLength(2);
      expect(cached!.suggestions[0].title).toBe("Banana Smoothie");
    });

    it("returns undefined when profile hash does not match", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_original",
        sampleSuggestions,
        futureDate(),
      );

      const cached = await getSuggestionCache(
        item.id,
        testUser.id,
        "hash_different",
      );
      expect(cached).toBeUndefined();
    });

    it("returns undefined when entry has expired", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_expired",
        sampleSuggestions,
        pastDate(),
      );

      const cached = await getSuggestionCache(
        item.id,
        testUser.id,
        "hash_expired",
      );
      expect(cached).toBeUndefined();
    });

    it("returns undefined for non-existent scanned item id", async () => {
      const cached = await getSuggestionCache(999999, testUser.id, "hash_none");
      expect(cached).toBeUndefined();
    });
  });

  describe("incrementSuggestionCacheHit", () => {
    it("increments the hit count by 1", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      const { id } = await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_hit",
        sampleSuggestions,
        futureDate(),
      );

      await incrementSuggestionCacheHit(id);
      await incrementSuggestionCacheHit(id);

      const { eq } = await import("drizzle-orm");
      const [directRow] = await tx
        .select({ hitCount: schema.suggestionCache.hitCount })
        .from(schema.suggestionCache)
        .where(eq(schema.suggestionCache.id, id));
      expect(directRow.hitCount).toBe(2);
    });
  });

  // ==========================================================================
  // INSTRUCTION CACHE
  // ==========================================================================

  describe("createInstructionCache", () => {
    it("creates an instruction cache entry", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      const { id: scId } = await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_instr",
        sampleSuggestions,
        futureDate(),
      );

      // Should not throw
      await createInstructionCache(
        scId,
        0,
        "Banana Smoothie",
        "recipe",
        "Step 1: Blend banana...",
      );
    });
  });

  describe("getInstructionCache", () => {
    it("returns cached instruction when found", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      const { id: scId } = await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_get_instr",
        sampleSuggestions,
        futureDate(),
      );

      await createInstructionCache(
        scId,
        0,
        "Banana Smoothie",
        "recipe",
        "Step 1: Blend banana",
      );
      const cached = await getInstructionCache(scId, 0);
      expect(cached).toBeDefined();
      expect(cached!.instructions).toBe("Step 1: Blend banana");
    });

    it("returns undefined for non-existent index", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      const { id: scId } = await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_no_instr",
        sampleSuggestions,
        futureDate(),
      );

      const cached = await getInstructionCache(scId, 99);
      expect(cached).toBeUndefined();
    });
  });

  describe("incrementInstructionCacheHit", () => {
    it("increments the instruction cache hit count", async () => {
      const item = await createTestScannedItem(tx, testUser.id);
      const { id: scId } = await createSuggestionCache(
        item.id,
        testUser.id,
        "hash_instr_hit",
        sampleSuggestions,
        futureDate(),
      );
      await createInstructionCache(scId, 0, "Smoothie", "recipe", "Blend it");

      const cached = await getInstructionCache(scId, 0);
      expect(cached).toBeDefined();

      await incrementInstructionCacheHit(cached!.id);
      await incrementInstructionCacheHit(cached!.id);
      await incrementInstructionCacheHit(cached!.id);

      const { eq } = await import("drizzle-orm");
      const [directRow] = await tx
        .select({ hitCount: schema.instructionCache.hitCount })
        .from(schema.instructionCache)
        .where(eq(schema.instructionCache.id, cached!.id));
      expect(directRow.hitCount).toBe(3);
    });
  });

  // ==========================================================================
  // INVALIDATION
  // ==========================================================================

  describe("invalidateSuggestionCacheForUser", () => {
    it("deletes all suggestion cache entries for the user and returns count", async () => {
      const item1 = await createTestScannedItem(tx, testUser.id);
      const item2 = await createTestScannedItem(tx, testUser.id);
      await createSuggestionCache(
        item1.id,
        testUser.id,
        "h1",
        sampleSuggestions,
        futureDate(),
      );
      await createSuggestionCache(
        item2.id,
        testUser.id,
        "h2",
        sampleSuggestions,
        futureDate(),
      );

      const deleted = await invalidateSuggestionCacheForUser(testUser.id);
      expect(deleted).toBe(2);

      // Verify they are gone
      const cached1 = await getSuggestionCache(item1.id, testUser.id, "h1");
      const cached2 = await getSuggestionCache(item2.id, testUser.id, "h2");
      expect(cached1).toBeUndefined();
      expect(cached2).toBeUndefined();
    });

    it("returns 0 when user has no cache entries", async () => {
      const deleted = await invalidateSuggestionCacheForUser(testUser.id);
      expect(deleted).toBe(0);
    });

    it("does not affect other users' caches", async () => {
      const otherUser = await createTestUser(tx);
      const item = await createTestScannedItem(tx, testUser.id);
      const otherItem = await createTestScannedItem(tx, otherUser.id);
      await createSuggestionCache(
        item.id,
        testUser.id,
        "mine",
        sampleSuggestions,
        futureDate(),
      );
      await createSuggestionCache(
        otherItem.id,
        otherUser.id,
        "theirs",
        sampleSuggestions,
        futureDate(),
      );

      await invalidateSuggestionCacheForUser(testUser.id);

      const otherCached = await getSuggestionCache(
        otherItem.id,
        otherUser.id,
        "theirs",
      );
      expect(otherCached).toBeDefined();
    });
  });

  // ==========================================================================
  // MEAL SUGGESTION CACHE
  // ==========================================================================

  describe("createMealSuggestionCache", () => {
    it("creates a meal suggestion cache entry", async () => {
      const entry = await createMealSuggestionCache(
        "meal_key_1",
        testUser.id,
        [sampleMealSuggestion],
        futureDate(),
      );
      expect(entry.id).toBeDefined();
      expect(entry.cacheKey).toBe("meal_key_1");
      expect(entry.userId).toBe(testUser.id);
      expect(entry.hitCount).toBe(0);
    });
  });

  describe("getMealSuggestionCache", () => {
    it("returns entry when cache key matches and not expired", async () => {
      await createMealSuggestionCache(
        "meal_get_1",
        testUser.id,
        [sampleMealSuggestion],
        futureDate(),
      );

      const cached = await getMealSuggestionCache("meal_get_1");
      expect(cached).toBeDefined();
      expect(cached!.cacheKey).toBe("meal_get_1");
      expect((cached!.suggestions as MealSuggestion[])[0].title).toBe(
        "Grilled Chicken Bowl",
      );
    });

    it("returns undefined when expired", async () => {
      await createMealSuggestionCache(
        "meal_expired",
        testUser.id,
        [sampleMealSuggestion],
        pastDate(),
      );

      const cached = await getMealSuggestionCache("meal_expired");
      expect(cached).toBeUndefined();
    });

    it("returns undefined for non-existent key", async () => {
      const cached = await getMealSuggestionCache("does_not_exist");
      expect(cached).toBeUndefined();
    });
  });

  describe("incrementMealSuggestionCacheHit", () => {
    it("increments the hit count", async () => {
      const entry = await createMealSuggestionCache(
        "meal_hit",
        testUser.id,
        [sampleMealSuggestion],
        futureDate(),
      );

      await incrementMealSuggestionCacheHit(entry.id);

      const { eq } = await import("drizzle-orm");
      const [directRow] = await tx
        .select({ hitCount: schema.mealSuggestionCache.hitCount })
        .from(schema.mealSuggestionCache)
        .where(eq(schema.mealSuggestionCache.id, entry.id));
      expect(directRow.hitCount).toBe(1);
    });
  });

  describe("getDailyMealSuggestionCount", () => {
    it("counts entries created today for the user", async () => {
      const entry1 = await createMealSuggestionCache(
        "daily_1",
        testUser.id,
        [sampleMealSuggestion],
        futureDate(),
      );
      await createMealSuggestionCache(
        "daily_2",
        testUser.id,
        [sampleMealSuggestion],
        futureDate(),
      );

      // Use createdAt from the DB row so the query date matches the
      // PostgreSQL CURRENT_TIMESTAMP regardless of timezone differences.
      const count = await getDailyMealSuggestionCount(
        testUser.id,
        entry1.createdAt,
      );
      expect(count).toBe(2);
    });

    it("returns 0 when no entries exist", async () => {
      const count = await getDailyMealSuggestionCount(testUser.id, new Date());
      expect(count).toBe(0);
    });

    it("does not count entries from other users", async () => {
      const otherUser = await createTestUser(tx);
      const otherEntry = await createMealSuggestionCache(
        "other_daily",
        otherUser.id,
        [sampleMealSuggestion],
        futureDate(),
      );

      const count = await getDailyMealSuggestionCount(
        testUser.id,
        otherEntry.createdAt,
      );
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // MICRONUTRIENT CACHE
  // ==========================================================================

  describe("setMicronutrientCache", () => {
    it("creates a new cache entry", async () => {
      const data = [{ nutrient: "Vitamin C", amount: 90 }];
      await setMicronutrientCache("micro_key_1", data, 60 * 60 * 1000);

      const cached = await getMicronutrientCache("micro_key_1");
      expect(cached).toBeDefined();
      expect(cached).toEqual(data);
    });

    it("upserts on conflict (updates existing key)", async () => {
      const original = [{ nutrient: "Iron", amount: 10 }];
      const updated = [{ nutrient: "Iron", amount: 18 }];

      await setMicronutrientCache("micro_upsert", original, 60 * 60 * 1000);
      await setMicronutrientCache("micro_upsert", updated, 60 * 60 * 1000);

      const cached = await getMicronutrientCache("micro_upsert");
      expect(cached).toEqual(updated);
    });

    it("resets hit count on upsert", async () => {
      await setMicronutrientCache("micro_reset", [{ a: 1 }], 60 * 60 * 1000);

      // Read to trigger a hit increment
      await getMicronutrientCache("micro_reset");
      // Small delay for the fire-and-forget update
      await new Promise((r) => setTimeout(r, 50));

      // Upsert should reset hit count to 0
      await setMicronutrientCache("micro_reset", [{ a: 2 }], 60 * 60 * 1000);

      const { eq } = await import("drizzle-orm");
      const [row] = await tx
        .select({ hitCount: schema.micronutrientCache.hitCount })
        .from(schema.micronutrientCache)
        .where(eq(schema.micronutrientCache.queryKey, "micro_reset"));
      expect(row.hitCount).toBe(0);
    });
  });

  describe("getMicronutrientCache", () => {
    it("returns data for non-expired entry", async () => {
      const data = [{ nutrient: "Zinc", amount: 11 }];
      await setMicronutrientCache("micro_get", data, 60 * 60 * 1000);

      const cached = await getMicronutrientCache("micro_get");
      expect(cached).toEqual(data);
    });

    it("returns undefined for expired entry", async () => {
      // Insert with a TTL that's already passed
      await tx.insert(schema.micronutrientCache).values({
        queryKey: "micro_expired",
        data: [{ nutrient: "B12", amount: 2.4 }],
        expiresAt: pastDate(),
      });

      const cached = await getMicronutrientCache("micro_expired");
      expect(cached).toBeUndefined();
    });

    it("returns undefined for non-existent key", async () => {
      const cached = await getMicronutrientCache("does_not_exist");
      expect(cached).toBeUndefined();
    });

    it("fires a hit count increment (fire-and-forget)", async () => {
      await setMicronutrientCache("micro_hit", [{ n: 1 }], 60 * 60 * 1000);

      await getMicronutrientCache("micro_hit");
      // Wait for the fire-and-forget update to complete
      await new Promise((r) => setTimeout(r, 100));

      const { eq } = await import("drizzle-orm");
      const [row] = await tx
        .select({ hitCount: schema.micronutrientCache.hitCount })
        .from(schema.micronutrientCache)
        .where(eq(schema.micronutrientCache.queryKey, "micro_hit"));
      expect(row.hitCount).toBe(1);
    });
  });
});
