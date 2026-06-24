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
import { users, userProfiles } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  isUniqueViolation,
  uniqueViolationConstraint,
} from "../../lib/db-errors";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getUser,
  getUserByUsername,
  getUserByEmail,
  createUser,
  updateUser,
  updateUserEmail,
  stagePendingEmail,
  applyEmailVerification,
  getUserTimezones,
  getUserProfile,
  createUserProfile,
  updateUserProfile,
  getSubscriptionStatus,
  getEffectiveTierForUser,
  updateSubscription,
  getTransaction,
  createTransaction,
  claimTransactionAndUpgrade,
  revokeSubscriptionByTransactionId,
  upsertProfileWithOnboarding,
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

  describe("getUserByEmail", () => {
    it("returns the user (without password) when found by email", async () => {
      const result = await getUserByEmail(testUser.email);
      expect(result).toBeDefined();
      expect(result!.id).toBe(testUser.id);
      expect(result).not.toHaveProperty("password");
    });

    it("returns undefined for a non-existent email", async () => {
      const result = await getUserByEmail("nonexistent@test.invalid");
      expect(result).toBeUndefined();
    });
  });

  describe("createUser", () => {
    it("creates and returns a new user", async () => {
      const newUser = await createUser({
        username: "fresh_user_123",
        email: "fresh_user_123@test.invalid",
        password: "hashed_pw",
      });
      expect(newUser).toBeDefined();
      expect(newUser.username).toBe("fresh_user_123");
      expect(newUser.email).toBe("fresh_user_123@test.invalid");
      expect(newUser.password).toBe("hashed_pw");
      expect(newUser.id).toBeDefined();
      // Defaults
      expect(newUser.subscriptionTier).toBe("free");
      expect(newUser.onboardingCompleted).toBe(false);
      expect(newUser.emailVerified).toBe(false);
    });

    it("rejects a case-variant duplicate email via the lower(email) functional unique index", async () => {
      // DB-enforced case-insensitive uniqueness. `createUser` does NOT normalize
      // (storage has no .toLowerCase() — normalization lives in registerSchema),
      // and the byte-exact users_email_unique would accept "Foo@Bar.com" and
      // "foo@bar.com" as two distinct rows. The functional unique index on
      // lower(email) rejects the second — this is the latent footgun the index
      // closes (a future write path that forgets to lowercase). drizzle-orm 0.44+
      // wraps the pg error, so assert the unwrapped 23505 via the shared helper
      // rather than matching message text (see api-keys.test.ts precedent).
      await createUser({
        username: "case_dup_a",
        email: "Foo@Bar.com",
        password: "hashed_pw",
      });
      const error = await createUser({
        username: "case_dup_b",
        email: "foo@bar.com",
        password: "hashed_pw",
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).not.toBeNull();
      expect(isUniqueViolation(error)).toBe(true);
      // Pin the constraint NAME, not just the 23505 code: the register
      // anti-enumeration branch routes on `constraint?.includes("email")`
      // (server/routes/auth.ts), so a future rename that drops "email" would
      // silently break the neutral-response path while a code-only assertion
      // stayed green.
      expect(uniqueViolationConstraint(error)).toContain("email");
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

  describe("updateUserEmail", () => {
    it("sets the new email AND resets emailVerified to false atomically", async () => {
      // Start from a verified account so the reset is observable.
      await tx
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, testUser.id));

      const result = await updateUserEmail(testUser.id, "moved@example.com");

      expect(result).toBeDefined();
      expect(result!.email).toBe("moved@example.com");
      // A changed address must re-prove ownership — never stay verified.
      expect(result!.emailVerified).toBe(false);
      // Returns a SafeUser — the password hash is never selected back.
      expect(
        (result as unknown as Record<string, unknown>).password,
      ).toBeUndefined();
    });

    it("returns undefined for a non-existent user id", async () => {
      const result = await updateUserEmail(
        "00000000-0000-0000-0000-000000000000",
        "ghost@example.com",
      );
      expect(result).toBeUndefined();
    });

    it("throws a unique violation when another account holds the email (case-insensitive)", async () => {
      await createTestUser(tx, { email: "taken@example.com" });

      let err: unknown;
      try {
        // Different case must still collide via the lower(email) unique index.
        await updateUserEmail(testUser.id, "TAKEN@example.com");
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(isUniqueViolation(err)).toBe(true);
    });

    it("also clears any staged pending_email (an immediate change supersedes a pending one)", async () => {
      await stagePendingEmail(testUser.id, "stale-pending@example.com");

      const result = await updateUserEmail(testUser.id, "direct@example.com");

      expect(result).toBeDefined();
      expect(result!.email).toBe("direct@example.com");
      // The stale pending change must not survive a direct overwrite, or its
      // old verification link could later commit a now-wrong address.
      expect(result!.pendingEmail).toBeNull();
    });
  });

  describe("stagePendingEmail", () => {
    it("stages the new address WITHOUT touching email or emailVerified", async () => {
      // Start verified so we can prove the current verified state is untouched.
      await tx
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, testUser.id));

      const result = await stagePendingEmail(
        testUser.id,
        "pending@example.com",
      );

      expect(result).toBeDefined();
      expect(result!.pendingEmail).toBe("pending@example.com");
      // The login-gating column and its verified flag must NOT change — that is
      // the whole point of staging (no typo-lockout, no /me oracle).
      expect(result!.email).toBe(testUser.email);
      expect(result!.emailVerified).toBe(true);
      // Returns a SafeUser — never the password hash.
      expect(
        (result as unknown as Record<string, unknown>).password,
      ).toBeUndefined();
    });

    it("succeeds even when the target is already registered to another account (no enumeration oracle)", async () => {
      // The anti-enumeration guarantee: there is NO unique constraint on
      // pending_email, so staging a taken address must NOT throw — otherwise a
      // caller could probe which addresses already have accounts.
      await createTestUser(tx, { email: "taken@example.com" });

      const result = await stagePendingEmail(testUser.id, "taken@example.com");

      expect(result).toBeDefined();
      expect(result!.pendingEmail).toBe("taken@example.com");
    });

    it("returns undefined for a non-existent user id", async () => {
      const result = await stagePendingEmail(
        "00000000-0000-0000-0000-000000000000",
        "ghost@example.com",
      );
      expect(result).toBeUndefined();
    });
  });

  describe("applyEmailVerification", () => {
    it("verifies the current email when the token matches it (signup path, case-insensitive)", async () => {
      const result = await applyEmailVerification(
        testUser.id,
        testUser.email.toUpperCase(),
      );

      expect(result).toBeDefined();
      expect(result!.emailVerified).toBe(true);
      // Current-email branch leaves the address itself unchanged.
      expect(result!.email).toBe(testUser.email);
    });

    it("commits a staged pending email: swaps it into email, sets verified, clears pending", async () => {
      await tx
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, testUser.id));
      await stagePendingEmail(testUser.id, "new@example.com");

      // Case-insensitive: the token email matches the lower(pending_email).
      const result = await applyEmailVerification(
        testUser.id,
        "NEW@example.com",
      );

      expect(result).toBeDefined();
      expect(result!.email).toBe("new@example.com");
      expect(result!.emailVerified).toBe(true);
      expect(result!.pendingEmail).toBeNull();

      const after = await getUser(testUser.id);
      expect(after!.email).toBe("new@example.com");
      expect(after!.pendingEmail).toBeNull();
    });

    it("rejects a stale token matching neither current nor pending (no-op, returns undefined)", async () => {
      await stagePendingEmail(testUser.id, "pending@example.com");

      const result = await applyEmailVerification(
        testUser.id,
        "stale@example.com",
      );

      expect(result).toBeUndefined();
      // Neither the current address nor the staged one may move.
      const after = await getUser(testUser.id);
      expect(after!.email).toBe(testUser.email);
      expect(after!.pendingEmail).toBe("pending@example.com");
    });

    it("throws a unique violation when committing a pending email another account now holds", async () => {
      await createTestUser(tx, { email: "taken@example.com" });
      // Staging is allowed (no constraint); the collision surfaces only at the
      // commit, where the users.email unique index is the arbiter.
      await stagePendingEmail(testUser.id, "taken@example.com");

      let err: unknown;
      try {
        await applyEmailVerification(testUser.id, "taken@example.com");
      } catch (e) {
        err = e;
      }
      expect(err).toBeDefined();
      expect(isUniqueViolation(err)).toBe(true);
    });

    it("is idempotent across a commit (re-applying the same token succeeds via the current-email branch)", async () => {
      await stagePendingEmail(testUser.id, "new@example.com");
      // First apply commits the swap (email becomes new@example.com).
      await applyEmailVerification(testUser.id, "new@example.com");

      // A mail-scanner prefetch + the real click both carry the same token;
      // after the commit it now matches the CURRENT email branch — harmless.
      const result = await applyEmailVerification(
        testUser.id,
        "new@example.com",
      );

      expect(result).toBeDefined();
      expect(result!.email).toBe("new@example.com");
      expect(result!.emailVerified).toBe(true);
    });

    it("returns undefined for a non-existent user id", async () => {
      const result = await applyEmailVerification(
        "00000000-0000-0000-0000-000000000000",
        "ghost@example.com",
      );
      expect(result).toBeUndefined();
    });
  });

  describe("getUserTimezones", () => {
    it("returns the stored timezone for a user who has one set", async () => {
      await updateUser(testUser.id, { timezone: "America/Los_Angeles" });
      const result = await getUserTimezones([testUser.id]);
      expect(result.get(testUser.id)).toBe("America/Los_Angeles");
    });

    it("returns null for a user whose timezone was never written", async () => {
      // createTestUser does not set timezone → column is NULL.
      const result = await getUserTimezones([testUser.id]);
      expect(result.get(testUser.id)).toBeNull();
    });

    it("batches multiple users in one query, keyed by id", async () => {
      const second = await createTestUser(tx);
      await updateUser(testUser.id, { timezone: "Europe/London" });
      const result = await getUserTimezones([testUser.id, second.id]);
      expect(result.get(testUser.id)).toBe("Europe/London");
      expect(result.get(second.id)).toBeNull();
      expect(result.size).toBe(2);
    });

    it("returns an empty map for empty input (no degenerate query)", async () => {
      const result = await getUserTimezones([]);
      expect(result.size).toBe(0);
    });

    it("omits unknown ids from the result map", async () => {
      const result = await getUserTimezones([
        "00000000-0000-0000-0000-000000000000",
      ]);
      expect(result.size).toBe(0);
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

    // CCPA/PIPEDA consent-timestamp invariant: the `healthDataConsentAt` column
    // is server-stamped (`new Date()` inside the storage function, never a
    // caller-supplied value) and append-only at the SQL layer (COALESCE).
    // Once stamped, a re-write cannot overwrite or backdate the legally
    // significant moment of consent.
    // (The recency window is widened to ±24h because the column is
    // `TIMESTAMP WITHOUT TIME ZONE` and PG round-trip drops offset info —
    // max TZ offset is 14h. The tight ±request-window check is covered by
    // the route tests where the Date is not PG-roundtripped.)
    it("stamps a recent healthDataConsentAt when recordConsent is true and none exists", async () => {
      await createTestUserProfile(tx, testUser.id, {});

      const updated = await updateUserProfile(testUser.id, {}, true);

      expect(updated!.healthDataConsentAt).toBeInstanceOf(Date);
      // Recency check: catch "hardcoded epoch / constant Date" regressions
      // while tolerating up-to-24h drift from TIMESTAMP WITHOUT TIME ZONE.
      const drift = Math.abs(
        updated!.healthDataConsentAt!.getTime() - Date.now(),
      );
      expect(drift).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("preserves existing healthDataConsentAt via COALESCE on re-stamp", async () => {
      await createTestUserProfile(tx, testUser.id, {});
      const firstStamp = await updateUserProfile(testUser.id, {}, true);
      const stored = firstStamp!.healthDataConsentAt;
      expect(stored).toBeInstanceOf(Date);

      // Re-stamping must not overwrite the original timestamp.
      const result = await updateUserProfile(testUser.id, {}, true);

      // The DB-stored value must be unchanged after the second call.
      expect(result!.healthDataConsentAt?.getTime()).toBe(stored!.getTime());
    });

    it("does not stamp healthDataConsentAt when recordConsent is omitted", async () => {
      await createTestUserProfile(tx, testUser.id, {});

      const updated = await updateUserProfile(testUser.id, {
        activityLevel: "high",
      });

      expect(updated!.healthDataConsentAt).toBeNull();
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

  describe("getEffectiveTierForUser", () => {
    it("returns 'free' for a new user (default tier)", async () => {
      const tier = await getEffectiveTierForUser(testUser.id);
      expect(tier).toBe("free");
    });

    it("returns 'premium' for active premium (no expiry)", async () => {
      await updateSubscription(testUser.id, "premium", null);
      const tier = await getEffectiveTierForUser(testUser.id);
      expect(tier).toBe("premium");
    });

    it("returns 'premium' for active premium (future expiry)", async () => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await updateSubscription(testUser.id, "premium", future);
      const tier = await getEffectiveTierForUser(testUser.id);
      expect(tier).toBe("premium");
    });

    it("downgrades to 'free' when premium has expired", async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await updateSubscription(testUser.id, "premium", past);
      const tier = await getEffectiveTierForUser(testUser.id);
      expect(tier).toBe("free");
    });

    it("returns 'free' for a non-existent user (fail-closed)", async () => {
      const tier = await getEffectiveTierForUser(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(tier).toBe("free");
    });

    it("falls back to 'free' when stored tier is invalid", async () => {
      await tx
        .update(users)
        .set({ subscriptionTier: "gold_ultra" })
        .where(eq(users.id, testUser.id));
      const tier = await getEffectiveTierForUser(testUser.id);
      expect(tier).toBe("free");
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

  describe("claimTransactionAndUpgrade", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    it("creates the transaction and upgrades the user on a first claim", async () => {
      const result = await claimTransactionAndUpgrade(
        {
          transactionId: "orig_claim_1",
          userId: testUser.id,
          receipt: "receipt_1",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
      );

      expect(result.status).toBe("created");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(future.getTime());
    });

    it("rejects a claim whose transactionId is already owned by another user (anti-sharing)", async () => {
      const other = await createTestUser(tx, { username: "iap_other_user" });
      await claimTransactionAndUpgrade(
        {
          transactionId: "orig_claim_2",
          userId: other.id,
          receipt: "receipt_owner",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
      );

      const result = await claimTransactionAndUpgrade(
        {
          transactionId: "orig_claim_2",
          userId: testUser.id,
          receipt: "receipt_attacker",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
      );

      expect(result.status).toBe("conflict");
      if (result.status === "conflict") {
        expect(result.existingUserId).toBe(other.id);
      }
      // The second user must NOT have been upgraded.
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).not.toBe("premium");
    });

    it("renews and refreshes expiry when the same user re-claims the transactionId", async () => {
      const early = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const later = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

      await claimTransactionAndUpgrade(
        {
          transactionId: "orig_claim_3",
          userId: testUser.id,
          receipt: "receipt_initial",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        early,
      );

      const result = await claimTransactionAndUpgrade(
        {
          transactionId: "orig_claim_3",
          userId: testUser.id,
          receipt: "receipt_renewed",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        later,
      );

      expect(result.status).toBe("renewed");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(later.getTime());
    });

    it("does not move expiry backward when a same-user re-claim carries an earlier expiry", async () => {
      const later = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      const earlier = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

      await claimTransactionAndUpgrade(
        {
          transactionId: "orig_claim_4",
          userId: testUser.id,
          receipt: "receipt_late",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        later,
      );

      // A stale / out-of-order receipt (Apple emits the renewal txn ~24h before
      // the period ends, so both validate in the overlap) carrying an EARLIER
      // expiry must NOT shorten the subscription — renewals are monotonic.
      const result = await claimTransactionAndUpgrade(
        {
          transactionId: "orig_claim_4",
          userId: testUser.id,
          receipt: "receipt_stale",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        earlier,
      );

      expect(result.status).toBe("renewed");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(later.getTime());
    });
  });

  describe("revokeSubscriptionByTransactionId", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    it("revokes premium for the user owning the transaction", async () => {
      await claimTransactionAndUpgrade(
        {
          transactionId: "txn_revoke_1",
          userId: testUser.id,
          receipt: "r",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
      );

      const result = await revokeSubscriptionByTransactionId("txn_revoke_1");

      expect(result).toEqual({ userId: testUser.id });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
    });

    it("returns null and changes nothing for an unknown transactionId", async () => {
      const result =
        await revokeSubscriptionByTransactionId("txn_does_not_exist");
      expect(result).toBeNull();
    });

    it("is idempotent — a second revoke leaves the user free", async () => {
      await claimTransactionAndUpgrade(
        {
          transactionId: "txn_revoke_2",
          userId: testUser.id,
          receipt: "r",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
      );

      await revokeSubscriptionByTransactionId("txn_revoke_2");
      const second = await revokeSubscriptionByTransactionId("txn_revoke_2");

      expect(second).toEqual({ userId: testUser.id });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
    });

    it("keeps premium when an older transaction is refunded but a newer completed subscription is active", async () => {
      // Distinct createdAt is required because CURRENT_TIMESTAMP returns the
      // transaction-start time inside the test transaction.
      const older = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      await createTransaction({
        transactionId: "txn_old_A",
        userId: testUser.id,
        receipt: "rA",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
        status: "completed",
        createdAt: older,
      });
      await createTransaction({
        transactionId: "txn_new_B",
        userId: testUser.id,
        receipt: "rB",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
        status: "completed",
        createdAt: newer,
      });
      // The user's active premium comes from the newer subscription B.
      await updateSubscription(testUser.id, "premium", future);

      const result = await revokeSubscriptionByTransactionId("txn_old_A");

      // The old transaction is found, but the user keeps premium because the
      // newer completed subscription is still active.
      expect(result).toEqual({ userId: testUser.id });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
    });
  });

  // ==========================================================================
  // UPSERT PROFILE WITH ONBOARDING
  // ==========================================================================

  describe("upsertProfileWithOnboarding", () => {
    it("creates a new profile and marks onboarding complete when no profile exists", async () => {
      // Verify testUser starts with onboardingCompleted = false
      const [before] = await tx
        .select()
        .from(users)
        .where(eq(users.id, testUser.id));
      expect(before.onboardingCompleted).toBe(false);

      const profile = await upsertProfileWithOnboarding(testUser.id, {
        dietType: "vegan",
        activityLevel: "moderate",
      });

      expect(profile).toBeDefined();
      expect(profile.userId).toBe(testUser.id);
      expect(profile.dietType).toBe("vegan");
      expect(profile.activityLevel).toBe("moderate");
      // recordConsent omitted → insert path must not stamp the consent column.
      expect(profile.healthDataConsentAt).toBeNull();

      // Verify onboardingCompleted is now true
      const [after] = await tx
        .select()
        .from(users)
        .where(eq(users.id, testUser.id));
      expect(after.onboardingCompleted).toBe(true);
    });

    it("updates an existing profile and marks onboarding complete", async () => {
      // Create an initial profile
      await createTestUserProfile(tx, testUser.id, { dietType: "vegan" });

      const profile = await upsertProfileWithOnboarding(testUser.id, {
        dietType: "keto",
        activityLevel: "high",
      });

      expect(profile).toBeDefined();
      expect(profile.dietType).toBe("keto");
      expect(profile.activityLevel).toBe("high");

      // Verify onboardingCompleted is true
      const [updated] = await tx
        .select()
        .from(users)
        .where(eq(users.id, testUser.id));
      expect(updated.onboardingCompleted).toBe(true);

      // Verify only 1 profile row exists (no duplicate)
      const allProfiles = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, testUser.id));
      expect(allProfiles).toHaveLength(1);
    });

    it("returns a UserProfile with correct shape", async () => {
      const profile = await upsertProfileWithOnboarding(testUser.id, {
        dietType: "balanced",
        activityLevel: "low",
      });

      expect(profile).toMatchObject({
        id: expect.any(Number),
        userId: testUser.id,
        dietType: "balanced",
        activityLevel: "low",
      });
      expect(profile.createdAt).toBeDefined();
    });

    // CCPA/PIPEDA consent-timestamp invariant: the transactional upsert path
    // uses an existence guard to preserve the original `healthDataConsentAt`
    // when one is already recorded — replays of onboarding (e.g., user re-runs
    // the flow) cannot overwrite the legally significant consent moment.
    // The timestamp itself is generated inside the storage function from
    // `new Date()`; callers signal intent via the `recordConsent` flag.
    it("stamps a recent healthDataConsentAt on first onboarding when recordConsent is true", async () => {
      // `TIMESTAMP WITHOUT TIME ZONE` loses offset info on PG round-trip; we
      // assert a 24h-tolerant recency window (max TZ offset is 14h) to catch
      // "hardcoded epoch / constant Date" regressions. The tight
      // request-window check is covered by route tests where the Date is
      // not roundtripped through PG.
      const result = await upsertProfileWithOnboarding(
        testUser.id,
        { dietType: "vegan" },
        true,
      );

      expect(result.healthDataConsentAt).toBeInstanceOf(Date);
      const drift = Math.abs(
        result.healthDataConsentAt!.getTime() - Date.now(),
      );
      expect(drift).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("preserves existing healthDataConsentAt via existence guard on re-onboarding", async () => {
      await createTestUserProfile(tx, testUser.id, { dietType: "vegan" });
      const firstStamp = await updateUserProfile(testUser.id, {}, true);
      const stored = firstStamp!.healthDataConsentAt;
      expect(stored).toBeInstanceOf(Date);

      // Replay onboarding — re-stamp must NOT overwrite the original timestamp.
      const result = await upsertProfileWithOnboarding(
        testUser.id,
        { dietType: "keto" },
        true,
      );

      expect(result.healthDataConsentAt?.getTime()).toBe(stored!.getTime());
      // Other fields still update normally — only the consent column is locked.
      expect(result.dietType).toBe("keto");
    });
  });
});
