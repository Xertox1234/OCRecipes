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
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import type * as schema from "@shared/schema";
import { apiKeys, apiKeyUsage, barcodeNutrition } from "@shared/schema";
import { createMockApiKey } from "../../__tests__/factories/verification";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  createApiKey,
  getApiKeyByPrefix,
  getApiKey,
  revokeApiKey,
  updateApiKeyTier,
  listApiKeys,
  incrementUsage,
  getUsage,
  getUsageStats,
  insertBarcodeNutritionIfAbsent,
  getBarcodeNutrition,
} = await import("../api-keys");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("api-keys storage", () => {
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
  // createApiKey
  // ==========================================================================

  describe("createApiKey", () => {
    it("creates a key with prefix, returned plaintext, and bcrypt hash", async () => {
      const result = await createApiKey("Test Key", "free", testUser.id);
      expect(result.id).toBeDefined();
      // Format: ocr_live_ + 32 hex chars
      expect(result.plaintextKey).toMatch(/^ocr_live_[a-f0-9]{32}$/);
      // Prefix is first 16 chars
      expect(result.keyPrefix).toBe(result.plaintextKey.substring(0, 16));
      expect(result.keyPrefix.length).toBe(16);

      // Hash should verify against plaintext
      const [row] = await tx
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, result.id));
      expect(row.keyHash).not.toBe(result.plaintextKey);
      const verified = await bcrypt.compare(result.plaintextKey, row.keyHash);
      expect(verified).toBe(true);
    });

    it("stores name, tier, and ownerId on the row", async () => {
      const result = await createApiKey("My B2B Key", "pro", testUser.id);
      const stored = await getApiKey(result.id);
      expect(stored).toBeDefined();
      expect(stored!.name).toBe("My B2B Key");
      expect(stored!.tier).toBe("pro");
      expect(stored!.ownerId).toBe(testUser.id);
      expect(stored!.status).toBe("active");
      expect(stored!.revokedAt).toBeNull();
    });

    it("generates unique prefixes across multiple calls", async () => {
      const a = await createApiKey("A", "free", testUser.id);
      const b = await createApiKey("B", "free", testUser.id);
      expect(a.keyPrefix).not.toBe(b.keyPrefix);
      expect(a.plaintextKey).not.toBe(b.plaintextKey);
    });

    it("typed baseline matches factory shape (no `as unknown as` casts)", async () => {
      const result = await createApiKey("Shape Check", "free", testUser.id);
      const stored = await getApiKey(result.id);
      // Use factory as typed baseline; assert created row has same fields shape.
      const baseline = createMockApiKey({
        id: stored!.id,
        keyPrefix: stored!.keyPrefix,
        keyHash: stored!.keyHash,
        name: "Shape Check",
        ownerId: testUser.id,
        createdAt: stored!.createdAt,
      });
      expect(Object.keys(stored!).sort()).toEqual(Object.keys(baseline).sort());
    });

    it("rejects a duplicate keyPrefix via the unique constraint", async () => {
      // Verify the unique(keyPrefix) index is wired. `createApiKey` has no
      // retry logic, so a collision raises at the DB layer. Insert a second
      // row with an explicitly duplicated prefix and expect a PG unique-
      // violation error.
      const first = await createApiKey("Original", "free", testUser.id);
      await expect(
        tx.insert(apiKeys).values({
          keyPrefix: first.keyPrefix,
          keyHash:
            "$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP",
          name: "Collision",
          tier: "free",
          ownerId: testUser.id,
        }),
      ).rejects.toThrow(/duplicate key|unique constraint/i);
    });
  });

  // ==========================================================================
  // getApiKeyByPrefix
  // ==========================================================================

  describe("getApiKeyByPrefix", () => {
    it("returns the row when prefix matches", async () => {
      const created = await createApiKey("By Prefix", "free", testUser.id);
      const result = await getApiKeyByPrefix(created.keyPrefix);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
      expect(result!.keyPrefix).toBe(created.keyPrefix);
    });

    it("returns null when no key matches the prefix", async () => {
      const result = await getApiKeyByPrefix("ocr_live_nomatch");
      expect(result).toBeNull();
    });

    it("returns null for malformed prefix", async () => {
      const result = await getApiKeyByPrefix("not_a_real_prefix");
      expect(result).toBeNull();
    });

    // NOTE: getApiKeyByPrefix does not filter by owner — the route layer is
    // responsible for ownership verification after prefix lookup + bcrypt.
    it("returns the row regardless of caller — route enforces ownership", async () => {
      const other = await createTestUser(tx, { username: "owner_b_prefix" });
      const created = await createApiKey("Other Owner", "free", other.id);
      const result = await getApiKeyByPrefix(created.keyPrefix);
      expect(result).not.toBeNull();
      expect(result!.ownerId).toBe(other.id);
    });
  });

  // ==========================================================================
  // getApiKey
  // ==========================================================================

  describe("getApiKey", () => {
    it("returns the row when id matches", async () => {
      const created = await createApiKey("By Id", "free", testUser.id);
      const result = await getApiKey(created.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
    });

    it("returns null when id does not exist", async () => {
      const result = await getApiKey(999_999);
      expect(result).toBeNull();
    });

    // NOTE: getApiKey does not filter by owner — the route layer is
    // responsible for ownership verification before returning data.
    it("returns the row regardless of caller — route enforces ownership", async () => {
      const other = await createTestUser(tx, { username: "owner_b_id" });
      const created = await createApiKey("Other Owner", "free", other.id);
      const result = await getApiKey(created.id);
      expect(result).not.toBeNull();
      expect(result!.ownerId).toBe(other.id);
    });
  });

  // ==========================================================================
  // revokeApiKey
  // ==========================================================================

  describe("revokeApiKey", () => {
    it("sets status to revoked and stamps revokedAt", async () => {
      const created = await createApiKey("To Revoke", "free", testUser.id);
      await revokeApiKey(created.id);
      const stored = await getApiKey(created.id);
      expect(stored!.status).toBe("revoked");
      expect(stored!.revokedAt).toBeInstanceOf(Date);
    });

    it("is idempotent — revoking twice does not throw", async () => {
      const created = await createApiKey("Twice Revoke", "free", testUser.id);
      await revokeApiKey(created.id);
      const firstStored = await getApiKey(created.id);
      const firstRevokedAt = firstStored!.revokedAt;
      // Second revoke succeeds without throwing
      await expect(revokeApiKey(created.id)).resolves.toBeUndefined();
      const secondStored = await getApiKey(created.id);
      expect(secondStored!.status).toBe("revoked");
      // revokedAt updated on each call (idempotent in outcome, not value)
      expect(secondStored!.revokedAt).toBeInstanceOf(Date);
      expect(secondStored!.revokedAt!.getTime()).toBeGreaterThanOrEqual(
        firstRevokedAt!.getTime(),
      );
    });

    it("no-ops cleanly for a non-existent id", async () => {
      await expect(revokeApiKey(999_999)).resolves.toBeUndefined();
    });

    // NOTE: revokeApiKey takes only the key id — no owner parameter — so the
    // storage layer cannot enforce IDOR. The route layer must verify
    // ownership before calling this function. The assertion below documents
    // the storage-layer behavior so route-side ownership checks are not
    // accidentally pushed down here.
    it("revokes a key without owner check — route layer enforces IDOR", async () => {
      const other = await createTestUser(tx, { username: "owner_b_revoke" });
      const created = await createApiKey("Other Key", "free", other.id);
      await revokeApiKey(created.id);
      const stored = await getApiKey(created.id);
      expect(stored!.status).toBe("revoked");
    });
  });

  // ==========================================================================
  // updateApiKeyTier
  // ==========================================================================

  describe("updateApiKeyTier", () => {
    it("updates the tier field", async () => {
      const created = await createApiKey("Tier Update", "free", testUser.id);
      await updateApiKeyTier(created.id, "pro");
      const stored = await getApiKey(created.id);
      expect(stored!.tier).toBe("pro");
    });

    it("no-ops cleanly for a non-existent id", async () => {
      await expect(
        updateApiKeyTier(999_999, "enterprise"),
      ).resolves.toBeUndefined();
    });

    // NOTE: updateApiKeyTier takes only the key id — no owner parameter — so
    // the storage layer cannot enforce IDOR. The route layer must verify
    // ownership before calling this function. Matches the revokeApiKey
    // contract above.
    it("updates tier without owner check — route layer enforces IDOR", async () => {
      const other = await createTestUser(tx, { username: "owner_b_tier" });
      const created = await createApiKey("Other Key", "free", other.id);
      await updateApiKeyTier(created.id, "pro");
      const stored = await getApiKey(created.id);
      expect(stored!.tier).toBe("pro");
    });
  });

  // ==========================================================================
  // listApiKeys
  // ==========================================================================

  describe("listApiKeys", () => {
    it("returns only the owner's keys when filtered (IDOR protection)", async () => {
      const userA = testUser;
      const userB = await createTestUser(tx, { username: "owner_b_list" });

      const aKey1 = await createApiKey("A-1", "free", userA.id);
      const aKey2 = await createApiKey("A-2", "free", userA.id);
      const bKey1 = await createApiKey("B-1", "free", userB.id);

      const aKeys = await listApiKeys(userA.id);
      const aIds = aKeys.map((k) => k.id).sort();
      expect(aIds).toEqual([aKey1.id, aKey2.id].sort());
      expect(aKeys.find((k) => k.id === bKey1.id)).toBeUndefined();
    });

    it("returns all keys when no ownerId filter is passed", async () => {
      // NOTE: `listApiKeys()` with no filter returns rows committed before this
      // test's BEGIN as well — read-committed isolation means pre-existing
      // seed/dev rows are visible. We assert containment of our newly created
      // IDs (deterministic) rather than an exact total count (non-deterministic
      // across environments).
      const userB = await createTestUser(tx, { username: "owner_b_listall" });
      const a = await createApiKey("A-only", "free", testUser.id);
      const b = await createApiKey("B-only", "free", userB.id);

      const all = await listApiKeys();
      const ids = new Set(all.map((k) => k.id));
      expect(ids.has(a.id)).toBe(true);
      expect(ids.has(b.id)).toBe(true);
    });

    it("respects the limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await createApiKey(`Limit-${i}`, "free", testUser.id);
      }
      const result = await listApiKeys(testUser.id, 2);
      expect(result.length).toBe(2);
    });

    it("returns empty array when owner has no keys", async () => {
      const lonely = await createTestUser(tx, { username: "lonely_owner" });
      const result = await listApiKeys(lonely.id);
      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // incrementUsage
  // ==========================================================================

  describe("incrementUsage", () => {
    it("inserts a row with count=1 on first call", async () => {
      const created = await createApiKey("Usage 1st", "free", testUser.id);
      await incrementUsage(created.id);
      const count = await getUsage(created.id);
      expect(count).toBe(1);
    });

    it("upserts the same row month-over-month — repeated calls add up", async () => {
      const created = await createApiKey("Usage Many", "free", testUser.id);
      await incrementUsage(created.id);
      await incrementUsage(created.id);
      await incrementUsage(created.id);
      const count = await getUsage(created.id);
      expect(count).toBe(3);

      // Only one row exists for (apiKeyId, yearMonth) due to unique index
      const rows = await tx
        .select()
        .from(apiKeyUsage)
        .where(eq(apiKeyUsage.apiKeyId, created.id));
      expect(rows.length).toBe(1);
    });

    it("serialized concurrent calls accumulate count via ON CONFLICT DO UPDATE", async () => {
      // Note: within a single PG transaction (test isolation), Promise.all
      // operations serialize on the same connection. The constraint under
      // test is that the (apiKeyId, yearMonth) unique index + ON CONFLICT
      // DO UPDATE produces a correct accumulating count rather than a
      // duplicate-key error.
      const created = await createApiKey(
        "Usage Concurrent",
        "free",
        testUser.id,
      );
      await Promise.all([
        incrementUsage(created.id),
        incrementUsage(created.id),
        incrementUsage(created.id),
        incrementUsage(created.id),
        incrementUsage(created.id),
      ]);
      const count = await getUsage(created.id);
      expect(count).toBe(5);
    });

    it("stamps lastRequestAt on each increment", async () => {
      const created = await createApiKey("Usage At", "free", testUser.id);
      await incrementUsage(created.id);
      const [row] = await tx
        .select()
        .from(apiKeyUsage)
        .where(eq(apiKeyUsage.apiKeyId, created.id));
      expect(row.lastRequestAt).toBeInstanceOf(Date);
    });
  });

  // ==========================================================================
  // getUsage
  // ==========================================================================

  describe("getUsage", () => {
    it("returns 0 when no usage row exists", async () => {
      const created = await createApiKey("No Usage", "free", testUser.id);
      const count = await getUsage(created.id);
      expect(count).toBe(0);
    });

    it("returns the count for the current month by default", async () => {
      const created = await createApiKey("Default Month", "free", testUser.id);
      await incrementUsage(created.id);
      await incrementUsage(created.id);
      const count = await getUsage(created.id);
      expect(count).toBe(2);
    });

    it("returns the count for an explicit yearMonth when provided", async () => {
      const created = await createApiKey("Explicit Month", "free", testUser.id);
      // Insert usage for a past month directly
      await tx.insert(apiKeyUsage).values({
        apiKeyId: created.id,
        yearMonth: "2024-01",
        requestCount: 42,
        lastRequestAt: new Date("2024-01-15T12:00:00Z"),
      });
      const count = await getUsage(created.id, "2024-01");
      expect(count).toBe(42);

      // Current month is still 0
      const currentCount = await getUsage(created.id);
      expect(currentCount).toBe(0);
    });
  });

  // ==========================================================================
  // getUsageStats
  // ==========================================================================

  describe("getUsageStats", () => {
    it("returns yearMonth and requestCount for current month", async () => {
      const created = await createApiKey("Stats", "free", testUser.id);
      await incrementUsage(created.id);
      await incrementUsage(created.id);
      const stats = await getUsageStats(created.id);
      expect(stats.requestCount).toBe(2);
      expect(stats.yearMonth).toMatch(/^\d{4}-\d{2}$/);
      const now = new Date();
      const expectedYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      expect(stats.yearMonth).toBe(expectedYm);
    });

    it("returns 0 count when no usage exists", async () => {
      const created = await createApiKey("Stats Zero", "free", testUser.id);
      const stats = await getUsageStats(created.id);
      expect(stats.requestCount).toBe(0);
    });
  });

  // ==========================================================================
  // insertBarcodeNutritionIfAbsent
  // ==========================================================================

  describe("insertBarcodeNutritionIfAbsent", () => {
    it("inserts a new barcode row when none exists", async () => {
      await insertBarcodeNutritionIfAbsent({
        barcode: "0001234567890",
        productName: "Test Product",
        brandName: "Test Brand",
        servingSize: "100g",
        calories: "200",
        protein: "10",
        carbs: "25",
        fat: "8",
        source: "usda",
      });
      const [row] = await tx
        .select()
        .from(barcodeNutrition)
        .where(eq(barcodeNutrition.barcode, "0001234567890"));
      expect(row).toBeDefined();
      expect(row.productName).toBe("Test Product");
      expect(row.source).toBe("usda");
    });

    it("does NOT overwrite existing data on conflict (idempotent insert)", async () => {
      await insertBarcodeNutritionIfAbsent({
        barcode: "0009999999999",
        productName: "Original",
        source: "usda",
      });
      await insertBarcodeNutritionIfAbsent({
        barcode: "0009999999999",
        productName: "Updated",
        source: "api-ninjas",
      });
      const [row] = await tx
        .select()
        .from(barcodeNutrition)
        .where(eq(barcodeNutrition.barcode, "0009999999999"));
      // First write wins — second call is a no-op (onConflictDoNothing).
      expect(row.productName).toBe("Original");
      expect(row.source).toBe("usda");
    });

    it("accepts null/undefined optional fields", async () => {
      await insertBarcodeNutritionIfAbsent({
        barcode: "0008888888888",
        source: "cnf",
      });
      const [row] = await tx
        .select()
        .from(barcodeNutrition)
        .where(eq(barcodeNutrition.barcode, "0008888888888"));
      expect(row).toBeDefined();
      expect(row.productName).toBeNull();
      expect(row.brandName).toBeNull();
      expect(row.calories).toBeNull();
    });
  });

  // ==========================================================================
  // getBarcodeNutrition
  // ==========================================================================

  describe("getBarcodeNutrition", () => {
    it("returns null when no variants match", async () => {
      const result = await getBarcodeNutrition(["0007777777777"]);
      expect(result).toBeNull();
    });

    it("returns null when variants array is empty", async () => {
      const result = await getBarcodeNutrition([]);
      expect(result).toBeNull();
    });

    it("returns the row matching the variant", async () => {
      await insertBarcodeNutritionIfAbsent({
        barcode: "0006666666666",
        productName: "Variant Match",
        source: "usda",
      });
      const result = await getBarcodeNutrition(["0006666666666"]);
      expect(result).not.toBeNull();
      expect(result!.productName).toBe("Variant Match");
    });

    it("returns the highest-priority match when multiple variants exist", async () => {
      // Insert two distinct barcodes
      await insertBarcodeNutritionIfAbsent({
        barcode: "0001111111111",
        productName: "Variant A (priority)",
        source: "usda",
      });
      await insertBarcodeNutritionIfAbsent({
        barcode: "0002222222222",
        productName: "Variant B",
        source: "usda",
      });
      // Priority is determined by position in the variants array — first wins.
      const result = await getBarcodeNutrition([
        "0001111111111",
        "0002222222222",
      ]);
      expect(result).not.toBeNull();
      expect(result!.productName).toBe("Variant A (priority)");

      // Reverse priority — now B wins.
      const reversed = await getBarcodeNutrition([
        "0002222222222",
        "0001111111111",
      ]);
      expect(reversed).not.toBeNull();
      expect(reversed!.productName).toBe("Variant B");
    });

    it("returns the matching row when only a lower-priority variant exists in DB", async () => {
      await insertBarcodeNutritionIfAbsent({
        barcode: "0003333333333",
        productName: "Only This",
        source: "usda",
      });
      const result = await getBarcodeNutrition([
        "0009999999999", // not in DB — highest priority
        "0003333333333", // in DB — lower priority
      ]);
      expect(result).not.toBeNull();
      expect(result!.productName).toBe("Only This");
    });
  });
});
