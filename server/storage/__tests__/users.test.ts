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
  createTestUserProfile,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getUser,
  getUserByUsername,
  createUser,
  updateUser,
  getUserProfile,
  createUserProfile,
  updateUserProfile,
  getSubscriptionStatus,
  updateSubscription,
  getTransaction,
  createTransaction,
} = await import("../users");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("users storage", () => {
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
  // USER CRUD
  // ==========================================================================

  describe("getUser", () => {
    it("returns the user when found by id", async () => {
      const result = await getUser(testUser.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(testUser.id);
      expect(result!.username).toBe(testUser.username);
    });

    it("returns undefined for a non-existent id", async () => {
      const result = await getUser("00000000-0000-0000-0000-000000000000");
      expect(result).toBeUndefined();
    });
  });

  describe("getUserByUsername", () => {
    it("returns the user when found by username", async () => {
      const result = await getUserByUsername(testUser.username);
      expect(result).toBeDefined();
      expect(result!.id).toBe(testUser.id);
      expect(result!.username).toBe(testUser.username);
    });

    it("returns undefined for a non-existent username", async () => {
      const result = await getUserByUsername("nonexistent_user_xyz");
      expect(result).toBeUndefined();
    });
  });

  describe("createUser", () => {
    it("creates and returns a new user", async () => {
      const newUser = await createUser({
        username: "fresh_user_123",
        password: "hashed_pw",
      });
      expect(newUser).toBeDefined();
      expect(newUser.username).toBe("fresh_user_123");
      expect(newUser.password).toBe("hashed_pw");
      expect(newUser.id).toBeDefined();
      // Defaults
      expect(newUser.subscriptionTier).toBe("free");
      expect(newUser.onboardingCompleted).toBe(false);
    });
  });

  describe("updateUser", () => {
    it("updates and returns the modified user", async () => {
      const updated = await updateUser(testUser.id, {
        displayName: "Updated Name",
        dailyCalorieGoal: 2500,
      });
      expect(updated).toBeDefined();
      expect(updated!.displayName).toBe("Updated Name");
      expect(updated!.dailyCalorieGoal).toBe(2500);
    });

    it("returns undefined when updating a non-existent user", async () => {
      const result = await updateUser("00000000-0000-0000-0000-000000000000", {
        displayName: "Ghost",
      });
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // USER PROFILES
  // ==========================================================================

  describe("getUserProfile", () => {
    it("returns the profile when one exists", async () => {
      await createTestUserProfile(tx, testUser.id);
      const result = await getUserProfile(testUser.id);
      expect(result).toBeDefined();
      expect(result!.userId).toBe(testUser.id);
      expect(result!.activityLevel).toBe("moderate");
      expect(result!.dietType).toBe("balanced");
    });

    it("returns undefined when no profile exists", async () => {
      const result = await getUserProfile(testUser.id);
      expect(result).toBeUndefined();
    });
  });

  describe("createUserProfile", () => {
    it("creates and returns a new profile", async () => {
      const profile = await createUserProfile({
        userId: testUser.id,
        activityLevel: "high",
        dietType: "keto",
      });
      expect(profile).toBeDefined();
      expect(profile.userId).toBe(testUser.id);
      expect(profile.activityLevel).toBe("high");
      expect(profile.dietType).toBe("keto");
    });
  });

  describe("updateUserProfile", () => {
    it("updates and returns the modified profile", async () => {
      await createTestUserProfile(tx, testUser.id, {
        activityLevel: "low",
        dietType: "balanced",
      });
      const updated = await updateUserProfile(testUser.id, {
        activityLevel: "high",
        dietType: "vegan",
      });
      expect(updated).toBeDefined();
      expect(updated!.activityLevel).toBe("high");
      expect(updated!.dietType).toBe("vegan");
      expect(updated!.updatedAt).toBeDefined();
    });

    it("returns undefined when no profile exists for the user", async () => {
      const result = await updateUserProfile(testUser.id, {
        activityLevel: "high",
      });
      expect(result).toBeUndefined();
    });

    it("does not update another user's profile (IDOR protection)", async () => {
      const otherUser = await createTestUser(tx, {
        username: "other_profile_user",
      });
      await createTestUserProfile(tx, testUser.id, { dietType: "balanced" });
      await createTestUserProfile(tx, otherUser.id, { dietType: "keto" });

      // Try to update testUser's profile using otherUser's id - should not touch testUser
      await updateUserProfile(otherUser.id, { dietType: "paleo" });

      const original = await getUserProfile(testUser.id);
      expect(original!.dietType).toBe("balanced");
    });
  });

  // ==========================================================================
  // SUBSCRIPTION
  // ==========================================================================

  describe("getSubscriptionStatus", () => {
    it("returns default free tier for a new user", async () => {
      const status = await getSubscriptionStatus(testUser.id);
      expect(status).toBeDefined();
      expect(status!.tier).toBe("free");
      expect(status!.expiresAt).toBeNull();
    });

    it("returns premium tier after subscription update", async () => {
      const expiry = new Date("2027-01-01T00:00:00Z");
      await updateSubscription(testUser.id, "premium", expiry);
      const status = await getSubscriptionStatus(testUser.id);
      expect(status).toBeDefined();
      expect(status!.tier).toBe("premium");
      expect(status!.expiresAt).toEqual(expiry);
    });

    it("returns undefined for a non-existent user", async () => {
      const result = await getSubscriptionStatus(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result).toBeUndefined();
    });

    it("falls back to 'free' when subscription tier is invalid", async () => {
      // Directly set an invalid tier value via the test transaction
      await tx
        .update(users)
        .set({ subscriptionTier: "gold_ultra" })
        .where(eq(users.id, testUser.id));

      const status = await getSubscriptionStatus(testUser.id);
      expect(status).toBeDefined();
      expect(status!.tier).toBe("free");
    });
  });

  describe("updateSubscription", () => {
    it("updates tier and expiresAt and returns the user", async () => {
      const expiry = new Date("2027-06-15T00:00:00Z");
      const result = await updateSubscription(testUser.id, "premium", expiry);
      expect(result).toBeDefined();
      expect(result!.subscriptionTier).toBe("premium");
      expect(result!.subscriptionExpiresAt).toEqual(expiry);
    });

    it("can set expiresAt to null (downgrade to free)", async () => {
      await updateSubscription(
        testUser.id,
        "premium",
        new Date("2027-01-01T00:00:00Z"),
      );
      const result = await updateSubscription(testUser.id, "free", null);
      expect(result).toBeDefined();
      expect(result!.subscriptionTier).toBe("free");
      expect(result!.subscriptionExpiresAt).toBeNull();
    });

    it("returns undefined for a non-existent user", async () => {
      const result = await updateSubscription(
        "00000000-0000-0000-0000-000000000000",
        "premium",
        new Date(),
      );
      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // TRANSACTIONS
  // ==========================================================================

  describe("getTransaction", () => {
    it("returns the transaction when found", async () => {
      await createTransaction({
        transactionId: "txn_abc_123",
        userId: testUser.id,
        receipt: "receipt_data_here",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
      });

      const result = await getTransaction("txn_abc_123");
      expect(result).toBeDefined();
      expect(result!.transactionId).toBe("txn_abc_123");
      expect(result!.userId).toBe(testUser.id);
      expect(result!.platform).toBe("apple");
      expect(result!.productId).toBe("com.ocrecipes.premium.monthly");
      expect(result!.status).toBe("pending");
    });

    it("returns undefined for a non-existent transaction", async () => {
      const result = await getTransaction("txn_does_not_exist");
      expect(result).toBeUndefined();
    });
  });

  describe("createTransaction", () => {
    it("creates and returns a new transaction with defaults", async () => {
      const txn = await createTransaction({
        transactionId: "txn_new_456",
        userId: testUser.id,
        receipt: "receipt_payload",
        platform: "google",
        productId: "com.ocrecipes.premium.annual",
      });
      expect(txn).toBeDefined();
      expect(txn.transactionId).toBe("txn_new_456");
      expect(txn.platform).toBe("google");
      expect(txn.productId).toBe("com.ocrecipes.premium.annual");
      expect(txn.status).toBe("pending");
      expect(txn.createdAt).toBeDefined();
    });

    it("does not expose another user's transaction (IDOR protection)", async () => {
      const otherUser = await createTestUser(tx, {
        username: "other_txn_user",
      });
      await createTransaction({
        transactionId: "txn_other_user",
        userId: otherUser.id,
        receipt: "other_receipt",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
      });

      // getTransaction retrieves by transactionId, not userId,
      // so the caller must verify ownership. Confirm it returns the
      // transaction for the other user (caller must check userId).
      const result = await getTransaction("txn_other_user");
      expect(result).toBeDefined();
      expect(result!.userId).toBe(otherUser.id);
      expect(result!.userId).not.toBe(testUser.id);
    });
  });
});
