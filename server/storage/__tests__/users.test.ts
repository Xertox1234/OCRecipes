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
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import {
  users,
  userProfiles,
  communityRecipes,
  savedItems,
  recipeDismissals,
  transactions,
  barcodeVerifications,
  verificationHistory,
  coachResponseCache,
  mealSuggestionCache,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  HEALTH_CONSENT_VERSION,
  PROFILE_HEALTH_FIELDS,
  USER_HEALTH_FIELDS,
  hasHealthData,
} from "@shared/lib/health-consent";
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
  setUserTimezoneIfUnset,
  updateUserEmail,
  stagePendingEmail,
  applyEmailVerification,
  getUserTimezones,
  getUserProfile,
  createUserProfile,
  updateUserProfile,
  saveReminderMutes,
  withdrawHealthConsent,
  getSubscriptionStatus,
  getEffectiveTierForUser,
  updateSubscription,
  upsertProfileWithOnboarding,
  deleteUser,
  RESERVED_USERNAMES,
  ReservedUsernameError,
  isReservedUsername,
  DELETE_USER_LOCK_THRESHOLD,
} = await import("../users");

const {
  getTransaction,
  createTransaction,
  claimTransactionAndUpgrade,
  extendSubscriptionByTransactionId,
  revokeSubscriptionByTransactionId,
  expireSubscriptionByTransactionId,
  reinstateSubscriptionByTransactionId,
} = await import("../subscriptions");

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

  describe("createUser — reserved usernames", () => {
    // WHY THIS LIVES AT THE STORAGE LAYER, NOT THE ROUTE: the two cleanup
    // scripts resolve their deletion scope with `eq(users.username, "demo")`
    // (scripts/cleanup-junk-recipes.ts:54, server/scripts/cleanup-seed-recipes.ts).
    // If a real person registers `demo`, their junk-matching recipes enter a
    // permanent-DELETE perimeter. A route-only check would leave every non-route
    // creation path open, and the route tests mock the auth middleware, so a
    // green route test can sit over an unprotected real path
    // (project_auth_recurring_breakage). These tests call `createUser` directly.
    const reject = (username: string) =>
      createUser({
        username,
        email: `${username.trim().toLowerCase()}-x@test.invalid`,
        password: "hashed_pw",
      }).then(
        () => null,
        (e: unknown) => e,
      );

    it("rejects the exact reserved username `demo`", async () => {
      const error = await reject("demo");
      expect(error).toBeInstanceOf(ReservedUsernameError);
    });

    it.each(["Demo", "DEMO", "dEmO"])(
      "rejects case variant %s — the lookup it endangers is an exact-string match",
      async (username) => {
        expect(await reject(username)).toBeInstanceOf(ReservedUsernameError);
      },
    );

    it.each([" demo", "demo ", "  demo  ", "\tdemo\n"])(
      "rejects whitespace variant %j",
      async (username) => {
        expect(await reject(username)).toBeInstanceOf(ReservedUsernameError);
      },
    );

    // NEGATIVE CONTROL — without this, a check that rejected EVERYTHING would
    // pass every assertion above. Also pins that the match is whole-string, not
    // a prefix: `demo_user` must remain registerable.
    it.each(["demo_user", "demonstration", "mydemo", "demo1"])(
      "still ALLOWS the non-reserved lookalike %s",
      async (username) => {
        const created = await createUser({
          username,
          email: `${username}@test.invalid`,
          password: "hashed_pw",
        });
        expect(created.username).toBe(username);
      },
    );

    // The REAL normalizer, pinned directly. server/routes/auth.ts calls this
    // exact function at its username pre-check, and auth.test.ts mocks
    // `../../storage` with a stand-in — so this block is the only place the
    // production trim/lowercase/whole-string semantics are actually exercised.
    describe("isReservedUsername (the real exported normalizer)", () => {
      it.each(["demo", "Demo", "DEMO", " demo ", "\tdemo\n", "  DeMo  "])(
        "returns true for %j",
        (username) => {
          expect(isReservedUsername(username)).toBe(true);
        },
      );

      it.each(["demo_user", "demonstration", "mydemo", "demo1", "dem", ""])(
        "returns false for %j",
        (username) => {
          expect(isReservedUsername(username)).toBe(false);
        },
      );
    });

    it("reserves whatever username the seed script actually inserts (drift detection)", () => {
      // Reads the REAL seed source and extracts the literal it inserts, rather
      // than asserting a hardcoded "demo" against a hardcoded constant — that
      // form stays green if the seed renames its account tomorrow, i.e. it
      // asserts a cross-file invariant it cannot observe. That is precisely the
      // anti-pattern this whole todo exists to fix
      // (docs/solutions/conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md),
      // so it must not be reproduced inside the fix.
      // process.cwd(), matching auth-route-wiring.test.ts: Vitest runs anchored
      // at the project root, and a `new URL(..., import.meta.url)` form does not
      // type-check here (lib.dom's URL and @types/node's URL are structurally
      // incompatible, which tsc rejects even though Vitest strips types and runs
      // it happily).
      const seedSrc = readFileSync(
        path.join(process.cwd(), "server", "scripts", "seed-recipes.ts"),
        "utf8",
      );
      const match = seedSrc.match(
        /\.insert\(users\)[\s\S]{0,400}?username:\s*"([^"]+)"/,
      );
      // Guard the extractor itself: if the seed is restructured so this regex
      // no longer matches, the test must go RED rather than silently assert
      // nothing (a null match would otherwise make the check vacuous).
      expect(
        match,
        "could not locate the seed script's inserted username literal — update this extractor",
      ).not.toBeNull();
      expect(RESERVED_USERNAMES).toContain(match![1]);
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
      // Nothing moved, so there is no previous address to tell.
      expect(result!.previousEmail).toBeUndefined();
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
      // The address it replaced, read under the same row lock — the route
      // tells it the account moved (auth audit L4).
      expect(result!.previousEmail).toBe(testUser.email);

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
      // The second apply moved nothing — no second notice.
      expect(result!.previousEmail).toBeUndefined();
    });

    it("returns undefined for a non-existent user id", async () => {
      const result = await applyEmailVerification(
        "00000000-0000-0000-0000-000000000000",
        "ghost@example.com",
      );
      expect(result).toBeUndefined();
    });
  });

  describe("setUserTimezoneIfUnset", () => {
    it("stores the timezone when none is set", async () => {
      expect(await setUserTimezoneIfUnset(testUser.id, "Asia/Tokyo")).toBe(
        true,
      );
      const result = await getUserTimezones([testUser.id]);
      expect(result.get(testUser.id)).toBe("Asia/Tokyo");
    });

    it("never overwrites a stored timezone (write-once cap)", async () => {
      await setUserTimezoneIfUnset(testUser.id, "Asia/Tokyo");
      expect(
        await setUserTimezoneIfUnset(testUser.id, "Pacific/Kiritimati"),
      ).toBe(false);
      const result = await getUserTimezones([testUser.id]);
      expect(result.get(testUser.id)).toBe("Asia/Tokyo");
    });
  });

  describe("getUserTimezones", () => {
    it("returns the stored timezone for a user who has one set", async () => {
      await setUserTimezoneIfUnset(testUser.id, "America/Los_Angeles");
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
      await setUserTimezoneIfUnset(testUser.id, "Europe/London");
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

  describe("health-data consent version and withdrawal", () => {
    it("records the policy version with the consent", async () => {
      await createTestUserProfile(tx, testUser.id, {});

      const updated = await updateUserProfile(testUser.id, {}, true);

      expect(updated!.healthDataConsentVersion).toBe(HEALTH_CONSENT_VERSION);
    });

    it("records the policy version when onboarding stamps the consent", async () => {
      const profile = await upsertProfileWithOnboarding(testUser.id, {}, true);

      expect(profile.healthDataConsentAt).toBeInstanceOf(Date);
      expect(profile.healthDataConsentVersion).toBe(HEALTH_CONSENT_VERSION);
    });

    it("withdrawal clears every health field, the consent and the body metrics", async () => {
      await createTestUserProfile(tx, testUser.id, {
        allergies: [{ name: "peanuts", severity: "severe" }],
        healthConditions: ["type 2 diabetes"],
        primaryGoal: "lose_weight",
        activityLevel: "moderate",
        glp1Mode: true,
        glp1Medication: "semaglutide",
        glp1StartDate: new Date("2026-01-01T00:00:00Z"),
        moodScore: 0.6,
        moodUpdatedAt: new Date("2026-11-01T00:00:00Z"),
        dietType: "vegan",
        foodDislikes: ["olives"],
      });
      await updateUserProfile(testUser.id, {}, true);
      await updateUser(testUser.id, {
        weight: "80.00",
        height: "180.00",
        age: 35,
        gender: "male",
        dailyCalorieGoal: 2100,
      });

      const profile = await withdrawHealthConsent(testUser.id);

      expect(profile).toBeDefined();
      expect(profile!.allergies).toEqual([]);
      expect(profile!.healthConditions).toEqual([]);
      expect(profile!.primaryGoal).toBeNull();
      expect(profile!.activityLevel).toBeNull();
      expect(profile!.glp1Mode).toBe(false);
      expect(profile!.glp1Medication).toBeNull();
      expect(profile!.glp1StartDate).toBeNull();
      expect(profile!.moodScore).toBe(0);
      expect(profile!.moodUpdatedAt).toBeNull();
      expect(profile!.healthDataConsentAt).toBeNull();
      expect(profile!.healthDataConsentVersion).toBeNull();
      expect(profile!.healthDataConsentWithdrawnAt).toBeInstanceOf(Date);
      // Preferences are not health data and stay.
      expect(profile!.dietType).toBe("vegan");
      expect(profile!.foodDislikes).toEqual(["olives"]);

      const user = await getUser(testUser.id);
      expect(user!.weight).toBeNull();
      expect(user!.height).toBeNull();
      expect(user!.age).toBeNull();
      expect(user!.gender).toBeNull();
      expect(user!.goalWeight).toBeNull();
      // A calorie target is a number the user chose, not a body metric.
      expect(user!.dailyCalorieGoal).toBe(2100);
    });

    it("a consent given after a withdrawal is stamped afresh", async () => {
      await createTestUserProfile(tx, testUser.id, {});
      await updateUserProfile(testUser.id, {}, true);
      await withdrawHealthConsent(testUser.id);

      const again = await updateUserProfile(testUser.id, {}, true);

      expect(again!.healthDataConsentAt).toBeInstanceOf(Date);
      expect(again!.healthDataConsentVersion).toBe(HEALTH_CONSENT_VERSION);
      expect(again!.healthDataConsentWithdrawnAt).toBeInstanceOf(Date);
    });

    it("withdrawal touches only the caller's own rows", async () => {
      const other = await createTestUser(tx);
      await createTestUserProfile(tx, other.id, {
        allergies: [{ name: "milk", severity: "mild" }],
      });
      await updateUserProfile(other.id, {}, true);
      await createTestUserProfile(tx, testUser.id, {});

      await withdrawHealthConsent(testUser.id);

      const untouched = await getUserProfile(other.id);
      expect(untouched!.allergies).toEqual([
        { name: "milk", severity: "mild" },
      ]);
      expect(untouched!.healthDataConsentAt).toBeInstanceOf(Date);
    });

    it("returns undefined when the user has no profile", async () => {
      expect(await withdrawHealthConsent(testUser.id)).toBeUndefined();
    });

    // The shared lists are the single source: a field added there must be
    // cleared here, or it would be gated on save but survive a withdrawal.
    it("clears every field in the shared health-field lists", async () => {
      await createTestUserProfile(tx, testUser.id, {
        allergies: [{ name: "peanuts", severity: "severe" }],
        healthConditions: ["type 2 diabetes"],
        primaryGoal: "lose_weight",
        activityLevel: "moderate",
        glp1Mode: true,
        glp1Medication: "semaglutide",
        glp1StartDate: new Date("2026-01-01T00:00:00Z"),
      });
      await tx
        .update(users)
        .set({
          weight: "80.00",
          height: "180.00",
          age: 35,
          gender: "male",
          goalWeight: "75.00",
        })
        .where(eq(users.id, testUser.id));

      const profile = await withdrawHealthConsent(testUser.id);
      const user = await getUser(testUser.id);

      for (const field of PROFILE_HEALTH_FIELDS) {
        expect(hasHealthData({ [field]: profile![field] }), field).toBe(false);
      }
      for (const field of USER_HEALTH_FIELDS) {
        expect(user![field], field).toBeNull();
      }
    });

    it("keeps an append-only history of consents and withdrawals", async () => {
      await createTestUserProfile(tx, testUser.id, {});

      const granted = await updateUserProfile(testUser.id, {}, true);
      expect(granted!.healthDataConsentHistory).toEqual([
        {
          event: "granted",
          at: expect.any(String),
          version: HEALTH_CONSENT_VERSION,
        },
      ]);

      // A repeat consent while one is on record adds nothing.
      const again = await updateUserProfile(testUser.id, {}, true);
      expect(again!.healthDataConsentHistory).toHaveLength(1);

      const withdrawn = await withdrawHealthConsent(testUser.id);
      expect(withdrawn!.healthDataConsentHistory.map((e) => e.event)).toEqual([
        "granted",
        "withdrawn",
      ]);

      await updateUserProfile(testUser.id, {}, true);
      const second = await withdrawHealthConsent(testUser.id);
      expect(second!.healthDataConsentHistory.map((e) => e.event)).toEqual([
        "granted",
        "withdrawn",
        "granted",
        "withdrawn",
      ]);
    });

    it("onboarding consent starts the history, and a replay adds nothing", async () => {
      const first = await upsertProfileWithOnboarding(testUser.id, {}, true);
      expect(first.healthDataConsentHistory.map((e) => e.event)).toEqual([
        "granted",
      ]);

      const replay = await upsertProfileWithOnboarding(testUser.id, {}, true);
      expect(replay.healthDataConsentHistory).toHaveLength(1);
    });

    it("never pairs today's policy version with a consent given earlier", async () => {
      await createTestUserProfile(tx, testUser.id, {});
      const earlier = new Date("2026-06-01T00:00:00Z");
      await tx
        .update(userProfiles)
        .set({ healthDataConsentAt: earlier, healthDataConsentVersion: null })
        .where(eq(userProfiles.userId, testUser.id));

      const result = await updateUserProfile(testUser.id, {}, true);

      expect(result!.healthDataConsentAt?.getTime()).toBe(earlier.getTime());
      expect(result!.healthDataConsentVersion).toBeNull();
      expect(result!.healthDataConsentHistory).toEqual([]);
    });

    it("withdrawal deletes the caller's cached AI answers, and only theirs", async () => {
      const other = await createTestUser(tx);
      await createTestUserProfile(tx, testUser.id, {});
      const expiresAt = new Date(Date.now() + 60_000);
      for (const userId of [testUser.id, other.id]) {
        await tx.insert(coachResponseCache).values({
          userId,
          questionHash: `hash-${userId}`,
          question: "what can I eat?",
          response: "avoid peanuts",
          expiresAt,
        });
        await tx.insert(mealSuggestionCache).values({
          userId,
          cacheKey: `key-${userId}`,
          suggestions: [],
          expiresAt,
        });
      }

      await withdrawHealthConsent(testUser.id);

      const coachRows = await tx.select().from(coachResponseCache);
      const mealRows = await tx.select().from(mealSuggestionCache);
      expect(coachRows.map((r) => r.userId)).toEqual([other.id]);
      expect(mealRows.map((r) => r.userId)).toEqual([other.id]);
    });
  });

  describe("saveReminderMutes", () => {
    it("creates the profile row when none exists", async () => {
      const result = await saveReminderMutes(testUser.id, { commitment: true });

      expect(result).toEqual({ commitment: true });
      const profile = await getUserProfile(testUser.id);
      expect(profile!.reminderMutes).toEqual({ commitment: true });
      expect(profile!.allergies).toEqual([]);
      expect(profile!.healthDataConsentAt).toBeNull();
    });

    it("merges into existing mutes and leaves other profile fields alone", async () => {
      await createTestUserProfile(tx, testUser.id, {
        dietType: "keto",
        reminderMutes: { "meal-log": true, commitment: false },
      });

      const result = await saveReminderMutes(testUser.id, { commitment: true });

      expect(result).toEqual({ "meal-log": true, commitment: true });
      const profile = await getUserProfile(testUser.id);
      expect(profile!.reminderMutes).toEqual({
        "meal-log": true,
        commitment: true,
      });
      expect(profile!.dietType).toBe("keto");
    });

    it("only touches the given user's row (IDOR protection)", async () => {
      const otherUser = await createTestUser(tx, {
        username: "other_mutes_user",
      });
      await createTestUserProfile(tx, testUser.id, {
        reminderMutes: { "daily-checkin": true },
      });

      await saveReminderMutes(otherUser.id, { "daily-checkin": false });

      const mine = await getUserProfile(testUser.id);
      expect(mine!.reminderMutes).toEqual({ "daily-checkin": true });
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

  describe("claimTransactionAndUpgrade after a refund/revoke", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const claim = (purchasedAt?: Date | null) =>
      claimTransactionAndUpgrade(
        {
          transactionId: "orig_revoked_1",
          userId: testUser.id,
          receipt: "receipt_replayed",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
        purchasedAt,
      );

    beforeEach(async () => {
      await claim(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
      await revokeSubscriptionByTransactionId("orig_revoked_1");
    });

    async function expectStillRevoked() {
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
      expect(user!.subscriptionExpiresAt).toBeNull();
      const txn = await getTransaction("orig_revoked_1");
      expect(txn!.status).toBe("revoked");
    }

    it("refuses to re-grant from a receipt with no purchase date (fails closed)", async () => {
      const result = await claim(undefined);

      expect(result.status).toBe("revoked");
      await expectStillRevoked();
    });

    it("refuses a replayed receipt purchased before the revocation", async () => {
      const result = await claim(new Date(Date.now() - 24 * 60 * 60 * 1000));

      expect(result.status).toBe("revoked");
      await expectStillRevoked();
    });

    it("grants a purchase made after the revocation (re-subscription keeps the same original id)", async () => {
      const result = await claim(new Date(Date.now() + 60 * 1000));

      expect(result.status).toBe("renewed");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(future.getTime());
      const txn = await getTransaction("orig_revoked_1");
      expect(txn!.status).toBe("completed");
    });
  });

  describe("revocation is timed by the store's revokedAt, not our processing time", () => {
    const day = 24 * 60 * 60 * 1000;
    const future = new Date(Date.now() + 30 * day);
    const storeRevokedAt = new Date(Date.now() - 10 * day);
    const claim = (purchasedAt?: Date | null) =>
      claimTransactionAndUpgrade(
        {
          transactionId: "orig_store_time_1",
          userId: testUser.id,
          receipt: "receipt_store_time",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
        purchasedAt,
      );

    beforeEach(async () => {
      await claim(new Date(Date.now() - 40 * day));
      await revokeSubscriptionByTransactionId(
        "orig_store_time_1",
        storeRevokedAt,
      );
    });

    it("stores the store's revocation time on the row", async () => {
      const txn = await getTransaction("orig_store_time_1");
      expect(txn!.status).toBe("revoked");
      expect(txn!.revokedAt?.getTime()).toBe(storeRevokedAt.getTime());
    });

    it("grants a receipt purchased after the store revocation even though we processed it later", async () => {
      const result = await claim(new Date(Date.now() - 5 * day));

      expect(result.status).toBe("renewed");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
      const txn = await getTransaction("orig_store_time_1");
      expect(txn!.status).toBe("completed");
      // Kept on re-activation: a redelivered copy of that refund is then ignored.
      expect(txn!.revokedAt?.getTime()).toBe(storeRevokedAt.getTime());
    });

    it("refuses a receipt purchased before the store revocation", async () => {
      const result = await claim(new Date(Date.now() - 11 * day));

      expect(result.status).toBe("revoked");
      const txn = await getTransaction("orig_store_time_1");
      expect(txn!.status).toBe("revoked");
    });

    it("never moves an existing revokedAt later on a repeat revoke", async () => {
      await revokeSubscriptionByTransactionId("orig_store_time_1", new Date());

      const txn = await getTransaction("orig_store_time_1");
      expect(txn!.revokedAt?.getTime()).toBe(storeRevokedAt.getTime());
      const result = await claim(new Date(Date.now() - 5 * day));
      expect(result.status).toBe("renewed");
    });

    it("re-arms revokedAt for a fresh refund after a re-activation", async () => {
      await claim(new Date(Date.now() - 5 * day));
      const secondRefund = new Date(Date.now() - 1 * day);
      await revokeSubscriptionByTransactionId(
        "orig_store_time_1",
        secondRefund,
      );

      const txn = await getTransaction("orig_store_time_1");
      expect(txn!.revokedAt?.getTime()).toBe(secondRefund.getTime());
      const result = await claim(new Date(Date.now() - 2 * day));
      expect(result.status).toBe("revoked");
    });

    it("re-activates from a renewal purchased after the store revocation and keeps revokedAt", async () => {
      const result = await extendSubscriptionByTransactionId(
        "orig_store_time_1",
        future,
        new Date(Date.now() - 5 * day),
      );

      expect(result).toEqual({ status: "extended", userId: testUser.id });
      const txn = await getTransaction("orig_store_time_1");
      expect(txn!.status).toBe("completed");
      // Kept on re-activation: a redelivered copy of that refund is then ignored.
      expect(txn!.revokedAt?.getTime()).toBe(storeRevokedAt.getTime());
    });

    it("stamps the processing time when the store gives no revocation time", async () => {
      await createTransaction({
        transactionId: "orig_no_store_time",
        userId: testUser.id,
        receipt: "r",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
        status: "completed",
      });

      await revokeSubscriptionByTransactionId("orig_no_store_time");

      const txn = await getTransaction("orig_no_store_time");
      expect(txn!.revokedAt).not.toBeNull();
      expect(Math.abs(txn!.revokedAt!.getTime() - Date.now())).toBeLessThan(
        24 * 60 * 60 * 1000,
      );
    });
  });

  describe("extendSubscriptionByTransactionId", () => {
    const day = 24 * 60 * 60 * 1000;
    const firstExpiry = new Date(Date.now() + 5 * day);
    const renewedExpiry = new Date(Date.now() + 370 * day);

    beforeEach(async () => {
      await claimTransactionAndUpgrade(
        {
          transactionId: "orig_renew_1",
          userId: testUser.id,
          receipt: "receipt_1",
          platform: "apple",
          productId: "com.ocrecipes.premium.annual",
          status: "completed",
        },
        "premium",
        firstExpiry,
        new Date(Date.now() - 360 * day),
      );
    });

    it("extends the owning user's expiry on a renewal", async () => {
      const result = await extendSubscriptionByTransactionId(
        "orig_renew_1",
        renewedExpiry,
        new Date(),
      );

      expect(result).toEqual({ status: "extended", userId: testUser.id });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(
        renewedExpiry.getTime(),
      );
    });

    it("never moves expiry backward (GREATEST)", async () => {
      const earlier = new Date(Date.now() + 1 * day);
      const result = await extendSubscriptionByTransactionId(
        "orig_renew_1",
        earlier,
        new Date(),
      );

      expect(result).toEqual({ status: "extended", userId: testUser.id });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(
        firstExpiry.getTime(),
      );
    });

    it("returns null and changes nothing for an unknown transaction", async () => {
      const result = await extendSubscriptionByTransactionId(
        "orig_unknown",
        renewedExpiry,
        new Date(),
      );

      expect(result).toBeNull();
      const user = await getUser(testUser.id);
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(
        firstExpiry.getTime(),
      );
    });

    it("does not extend a revoked transaction from a renewal purchased before the revocation", async () => {
      await revokeSubscriptionByTransactionId("orig_renew_1");

      for (const purchasedAt of [undefined, new Date(Date.now() - 60 * 1000)]) {
        const result = await extendSubscriptionByTransactionId(
          "orig_renew_1",
          renewedExpiry,
          purchasedAt,
        );
        expect(result).toEqual({ status: "revoked", userId: testUser.id });
      }
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
      expect(user!.subscriptionExpiresAt).toBeNull();
      const txn = await getTransaction("orig_renew_1");
      expect(txn!.status).toBe("revoked");
    });

    it("re-activates a revoked transaction for a renewal purchased after the revocation", async () => {
      await revokeSubscriptionByTransactionId("orig_renew_1");

      const result = await extendSubscriptionByTransactionId(
        "orig_renew_1",
        renewedExpiry,
        new Date(Date.now() + 60 * 1000),
      );

      expect(result).toEqual({ status: "extended", userId: testUser.id });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(
        renewedExpiry.getTime(),
      );
      const txn = await getTransaction("orig_renew_1");
      expect(txn!.status).toBe("completed");
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

      expect(result).toEqual({ userId: testUser.id, stale: false });
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

      expect(second).toEqual({ userId: testUser.id, stale: false });
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
      expect(result).toEqual({ userId: testUser.id, stale: false });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
    });
  });

  describe("expireSubscriptionByTransactionId", () => {
    const day = 24 * 60 * 60 * 1000;
    const future = new Date(Date.now() + 30 * day);
    const claim = (purchasedAt?: Date | null) =>
      claimTransactionAndUpgrade(
        {
          transactionId: "orig_expire_1",
          userId: testUser.id,
          receipt: "receipt_expire",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
        purchasedAt,
      );

    beforeEach(async () => {
      await claim(new Date(Date.now() - 40 * day));
    });

    it("marks the row expired (not revoked) and downgrades the user", async () => {
      const result = await expireSubscriptionByTransactionId("orig_expire_1");

      expect(result).toEqual({ userId: testUser.id });
      const txn = await getTransaction("orig_expire_1");
      expect(txn!.status).toBe("expired");
      expect(txn!.revokedAt).toBeNull();
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
      expect(user!.subscriptionExpiresAt).toBeNull();
    });

    it("returns null and changes nothing for an unknown transaction", async () => {
      const result = await expireSubscriptionByTransactionId("orig_unknown");

      expect(result).toBeNull();
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
    });

    it("lets a re-subscription restore after a late EXPIRED (purchase predates our processing)", async () => {
      // Re-subscribed 1 day ago; the stale EXPIRED is processed only now.
      await expireSubscriptionByTransactionId("orig_expire_1");

      const result = await claim(new Date(Date.now() - 1 * day));

      expect(result.status).toBe("renewed");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(future.getTime());
      const txn = await getTransaction("orig_expire_1");
      expect(txn!.status).toBe("completed");
    });

    it("lets a late DID_RENEW extend an expired row", async () => {
      await expireSubscriptionByTransactionId("orig_expire_1");

      const result = await extendSubscriptionByTransactionId(
        "orig_expire_1",
        future,
        new Date(Date.now() - 1 * day),
      );

      expect(result).toEqual({ status: "extended", userId: testUser.id });
      const txn = await getTransaction("orig_expire_1");
      expect(txn!.status).toBe("completed");
    });

    it("never turns a refunded row into a plain expiry", async () => {
      const refundedAt = new Date(Date.now() - 2 * day);
      await revokeSubscriptionByTransactionId("orig_expire_1", refundedAt);

      await expireSubscriptionByTransactionId("orig_expire_1");

      const txn = await getTransaction("orig_expire_1");
      expect(txn!.status).toBe("revoked");
      expect(txn!.revokedAt?.getTime()).toBe(refundedAt.getTime());
      const result = await claim(new Date(Date.now() - 3 * day));
      expect(result.status).toBe("revoked");
    });

    it("keeps premium when an older transaction expires but a newer completed subscription is active", async () => {
      const older = new Date(Date.now() - 10 * day);
      const newer = new Date(Date.now() - 1 * day);
      await createTransaction({
        transactionId: "txn_exp_old",
        userId: testUser.id,
        receipt: "rA",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
        status: "completed",
        createdAt: older,
      });
      await createTransaction({
        transactionId: "txn_exp_new",
        userId: testUser.id,
        receipt: "rB",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
        status: "completed",
        createdAt: newer,
      });
      await updateSubscription(testUser.id, "premium", future);

      const result = await expireSubscriptionByTransactionId("txn_exp_old");

      expect(result).toEqual({ userId: testUser.id });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
    });
  });

  describe("reinstateSubscriptionByTransactionId (Apple REFUND_REVERSED)", () => {
    const day = 24 * 60 * 60 * 1000;
    const future = new Date(Date.now() + 20 * day);
    const originalPurchase = new Date(Date.now() - 10 * day);
    const refundedAt = new Date(Date.now() - 2 * day);
    // The reversal Apple signed AFTER the refund it reverses.
    const signedAt = new Date(Date.now() - 1 * day);
    const claim = (purchasedAt?: Date | null) =>
      claimTransactionAndUpgrade(
        {
          transactionId: "orig_reversed_1",
          userId: testUser.id,
          receipt: "receipt_reversed",
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
        purchasedAt,
      );

    beforeEach(async () => {
      await claim(originalPurchase);
      await revokeSubscriptionByTransactionId("orig_reversed_1", refundedAt);
    });

    it("restores the row and premium when the reversed transaction is still in its period", async () => {
      const result = await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        future,
        signedAt,
      );

      expect(result).toEqual({ userId: testUser.id, stale: false });
      const txn = await getTransaction("orig_reversed_1");
      expect(txn!.status).toBe("completed");
      // Kept: it records the reversed refund, so a redelivered copy is ignored.
      expect(txn!.revokedAt?.getTime()).toBe(refundedAt.getTime());
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(future.getTime());
    });

    it("lets the original pre-refund receipt restore after the reversal", async () => {
      await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        future,
        signedAt,
      );

      const result = await claim(originalPurchase);

      expect(result.status).toBe("renewed");
    });

    it("restores only the row status when the reversed period has already ended", async () => {
      const result = await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        new Date(Date.now() - 1 * day),
        signedAt,
      );

      expect(result).toEqual({ userId: testUser.id, stale: false });
      const txn = await getTransaction("orig_reversed_1");
      expect(txn!.status).toBe("completed");
      // Kept: it records the reversed refund, so a redelivered copy is ignored.
      expect(txn!.revokedAt?.getTime()).toBe(refundedAt.getTime());
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
      expect(user!.subscriptionExpiresAt).toBeNull();
    });

    it("restores only the row status when the transaction has no expiry", async () => {
      await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        null,
        signedAt,
      );

      const txn = await getTransaction("orig_reversed_1");
      expect(txn!.status).toBe("completed");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
    });

    it("returns null and changes nothing for an unknown transaction", async () => {
      const result = await reinstateSubscriptionByTransactionId(
        "orig_unknown",
        future,
        signedAt,
      );

      expect(result).toBeNull();
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
    });

    it("does not flip a plain expired row back to completed", async () => {
      await createTransaction({
        transactionId: "orig_expired_only",
        userId: testUser.id,
        receipt: "r",
        platform: "apple",
        productId: "com.ocrecipes.premium.monthly",
        status: "completed",
      });
      await expireSubscriptionByTransactionId("orig_expired_only");

      await reinstateSubscriptionByTransactionId(
        "orig_expired_only",
        new Date(Date.now() - 1 * day),
        signedAt,
      );

      const txn = await getTransaction("orig_expired_only");
      expect(txn!.status).toBe("expired");
    });

    // Apple delivers out of order and retries for ~72h: a reversal signed
    // BEFORE the refund now on the row must not undo that later refund.
    it("ignores a reversal signed before the row's refund (stale, out-of-order delivery)", async () => {
      const staleSignedAt = new Date(refundedAt.getTime() - 1 * day);

      const result = await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        future,
        staleSignedAt,
      );

      expect(result).toEqual({ userId: testUser.id, stale: true });
      const txn = await getTransaction("orig_reversed_1");
      expect(txn!.status).toBe("revoked");
      expect(txn!.revokedAt?.getTime()).toBe(refundedAt.getTime());
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
      expect(user!.subscriptionExpiresAt).toBeNull();
      // The replay gate still holds against the pre-refund receipt.
      const replay = await claim(originalPurchase);
      expect(replay.status).toBe("revoked");
    });

    it("treats a reversal signed at the exact refund time as stale", async () => {
      const result = await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        future,
        refundedAt,
      );

      expect(result).toEqual({ userId: testUser.id, stale: true });
      const txn = await getTransaction("orig_reversed_1");
      expect(txn!.status).toBe("revoked");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
    });

    it("refund, reversal, second refund, then a retried copy of the reversal keeps the row revoked", async () => {
      // refund 1 (beforeEach, at refundedAt) -> reversal (signedAt)
      await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        future,
        signedAt,
      );
      // refund 2, after the reversal
      const secondRefund = new Date(signedAt.getTime() + 12 * 60 * 60 * 1000);
      await revokeSubscriptionByTransactionId("orig_reversed_1", secondRefund);

      // Apple's retried copy of the original reversal arrives last.
      const result = await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        future,
        signedAt,
      );

      expect(result).toEqual({ userId: testUser.id, stale: true });
      const txn = await getTransaction("orig_reversed_1");
      expect(txn!.status).toBe("revoked");
      expect(txn!.revokedAt?.getTime()).toBe(secondRefund.getTime());
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
      const replay = await claim(originalPurchase);
      expect(replay.status).toBe("revoked");
    });

    it("reinstates a legacy revoked row that has no revokedAt", async () => {
      await tx
        .update(transactions)
        .set({ revokedAt: null })
        .where(eq(transactions.transactionId, "orig_reversed_1"));

      const result = await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        future,
        signedAt,
      );

      expect(result).toEqual({ userId: testUser.id, stale: false });
      const txn = await getTransaction("orig_reversed_1");
      expect(txn!.status).toBe("completed");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
    });

    it("re-applies premium to a row that is not revoked and is not stale", async () => {
      await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        future,
        signedAt,
      );
      const later = new Date(future.getTime() + 5 * day);

      const result = await reinstateSubscriptionByTransactionId(
        "orig_reversed_1",
        later,
        new Date(signedAt.getTime() + 1000),
      );

      expect(result).toEqual({ userId: testUser.id, stale: false });
      const user = await getUser(testUser.id);
      expect(user!.subscriptionExpiresAt?.getTime()).toBe(later.getTime());
    });

    // Apple retries a notification for ~72h, so the REFUND a reversal undid
    // can arrive again after it. That copy must not downgrade the user.
    describe("a refund delivered again after its reversal", () => {
      const reverse = () =>
        reinstateSubscriptionByTransactionId(
          "orig_reversed_1",
          future,
          signedAt,
        );

      const expectStillPremium = async () => {
        const txn = await getTransaction("orig_reversed_1");
        expect(txn!.status).toBe("completed");
        const user = await getUser(testUser.id);
        expect(user!.subscriptionTier).toBe("premium");
        expect(user!.subscriptionExpiresAt?.getTime()).toBe(future.getTime());
      };

      it("leaves the row completed and the user premium", async () => {
        await reverse();

        const result = await revokeSubscriptionByTransactionId(
          "orig_reversed_1",
          refundedAt,
        );

        await expectStillPremium();
        expect(result).toEqual({ userId: testUser.id, stale: true });
        // The user's own pre-refund receipt still restores.
        const reclaim = await claim(originalPurchase);
        expect(reclaim.status).toBe("renewed");
      });

      it("is ignored when its revocationDate is earlier than the reversed refund", async () => {
        await reverse();

        const result = await revokeSubscriptionByTransactionId(
          "orig_reversed_1",
          new Date(refundedAt.getTime() - 1 * day),
        );

        await expectStillPremium();
        expect(result).toEqual({ userId: testUser.id, stale: true });
      });

      it("is still ignored after a renewal notification", async () => {
        await reverse();
        await extendSubscriptionByTransactionId(
          "orig_reversed_1",
          future,
          new Date(),
        );

        const result = await revokeSubscriptionByTransactionId(
          "orig_reversed_1",
          refundedAt,
        );

        await expectStillPremium();
        expect(result).toEqual({ userId: testUser.id, stale: true });
      });

      it("is still ignored after the user re-sends their receipt", async () => {
        await reverse();
        await claim(originalPurchase);

        const result = await revokeSubscriptionByTransactionId(
          "orig_reversed_1",
          refundedAt,
        );

        await expectStillPremium();
        expect(result).toEqual({ userId: testUser.id, stale: true });
      });

      it("a new refund with a later revocationDate still revokes", async () => {
        await reverse();
        const secondRefund = new Date(signedAt.getTime() + 60 * 60 * 1000);

        const result = await revokeSubscriptionByTransactionId(
          "orig_reversed_1",
          secondRefund,
        );

        expect(result).toEqual({ userId: testUser.id, stale: false });
        const txn = await getTransaction("orig_reversed_1");
        expect(txn!.status).toBe("revoked");
        expect(txn!.revokedAt?.getTime()).toBe(secondRefund.getTime());
        const user = await getUser(testUser.id);
        expect(user!.subscriptionTier).toBe("free");
        const replay = await claim(originalPurchase);
        expect(replay.status).toBe("revoked");
      });

      it("a refund with no store date (Google, or none sent) still revokes", async () => {
        await reverse();

        const result =
          await revokeSubscriptionByTransactionId("orig_reversed_1");

        expect(result).toEqual({ userId: testUser.id, stale: false });
        const txn = await getTransaction("orig_reversed_1");
        expect(txn!.status).toBe("revoked");
        const user = await getUser(testUser.id);
        expect(user!.subscriptionTier).toBe("free");
      });
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

  // Account deletion used to cascade the store-purchase ledger, so a refunded
  // purchase's record vanished and its pre-refund receipt could be replayed on
  // a new account (audit 2026-10-29 L-data-8; owner ruling 2026-11-06: keep an
  // anonymised record; one new account may take it over unless it was
  // refunded after the receipt's purchase).
  describe("deleteUser — store purchase ledger", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const future = new Date(Date.now() + 30 * DAY);
    const claimAs = (userId: string, purchasedAt?: Date | null) =>
      claimTransactionAndUpgrade(
        {
          transactionId: "orig_ledger_1",
          userId,
          receipt: `receipt_${userId}`,
          platform: "apple",
          productId: "com.ocrecipes.premium.monthly",
          status: "completed",
        },
        "premium",
        future,
        purchasedAt,
      );

    async function deletedOwnerOfPurchase(purchasedAt: Date) {
      const owner = await createTestUser(tx);
      expect((await claimAs(owner.id, purchasedAt)).status).toBe("created");
      expect(await deleteUser(owner.id)).toBe(true);
    }

    it("keeps the purchase record with no owner and no receipt", async () => {
      await deletedOwnerOfPurchase(new Date(Date.now() - 2 * DAY));

      const txn = await getTransaction("orig_ledger_1");
      expect(txn).toBeDefined();
      expect(txn!.userId).toBeNull();
      expect(txn!.receipt).toBe("");
    });

    it("lets one new account take over a deleted account's purchase", async () => {
      await deletedOwnerOfPurchase(new Date(Date.now() - 2 * DAY));

      const result = await claimAs(testUser.id, new Date(Date.now() - 2 * DAY));

      expect(result.status).toBe("created");
      const txn = await getTransaction("orig_ledger_1");
      expect(txn!.userId).toBe(testUser.id);
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("premium");
    });

    it("refuses a second new account once the purchase was taken over", async () => {
      await deletedOwnerOfPurchase(new Date(Date.now() - 2 * DAY));
      await claimAs(testUser.id, new Date(Date.now() - 2 * DAY));
      const third = await createTestUser(tx);

      const result = await claimAs(third.id, new Date(Date.now() - 2 * DAY));

      expect(result.status).toBe("conflict");
      const user = await getUser(third.id);
      expect(user!.subscriptionTier).not.toBe("premium");
    });

    it("refuses to hand a refunded purchase to a new account (pre-refund receipt replay)", async () => {
      const purchasedAt = new Date(Date.now() - 3 * DAY);
      await deletedOwnerOfPurchase(purchasedAt);
      // The refund lands on the anonymised record after the account is gone.
      await revokeSubscriptionByTransactionId(
        "orig_ledger_1",
        new Date(Date.now() - DAY),
      );

      const result = await claimAs(testUser.id, purchasedAt);

      expect(result.status).toBe("revoked");
      const user = await getUser(testUser.id);
      expect(user!.subscriptionTier).toBe("free");
      const txn = await getTransaction("orig_ledger_1");
      expect(txn!.userId).toBeNull();
    });

    it("keeps a refund recorded before the account was deleted", async () => {
      const owner = await createTestUser(tx);
      const purchasedAt = new Date(Date.now() - 3 * DAY);
      await claimAs(owner.id, purchasedAt);
      await revokeSubscriptionByTransactionId(
        "orig_ledger_1",
        new Date(Date.now() - DAY),
      );
      await deleteUser(owner.id);

      const result = await claimAs(testUser.id, purchasedAt);

      expect(result.status).toBe("revoked");
    });

    it("lets a new account take over a purchase re-subscribed after its refund", async () => {
      await deletedOwnerOfPurchase(new Date(Date.now() - 3 * DAY));
      await revokeSubscriptionByTransactionId(
        "orig_ledger_1",
        new Date(Date.now() - 2 * DAY),
      );

      const result = await claimAs(testUser.id, new Date(Date.now() - DAY));

      expect(result.status).toBe("created");
      const txn = await getTransaction("orig_ledger_1");
      expect(txn!.status).toBe("completed");
      expect(txn!.userId).toBe(testUser.id);
    });

    it("records store notifications on an ownerless record without touching any user", async () => {
      await deletedOwnerOfPurchase(new Date(Date.now() - 2 * DAY));

      const extended = await extendSubscriptionByTransactionId(
        "orig_ledger_1",
        future,
        new Date(Date.now() - DAY),
      );
      expect(extended).toEqual({ status: "ownerless", userId: null });

      const expired = await expireSubscriptionByTransactionId("orig_ledger_1");
      expect(expired).toEqual({ userId: null });
      expect((await getTransaction("orig_ledger_1"))!.status).toBe("expired");

      const revoked = await revokeSubscriptionByTransactionId(
        "orig_ledger_1",
        new Date(),
      );
      expect(revoked).toEqual({ userId: null, stale: false });
      expect((await getTransaction("orig_ledger_1"))!.status).toBe("revoked");
    });
  });

  describe("deleteUser — the author's community recipes", () => {
    // Saved items and dismissals reference a community recipe with no FK
    // (polymorphic); deleteCommunityRecipe removes them, deleteUser did not
    // (audit 2026-10-29 M-data-3).
    it("removes other users' saved items and dismissals of the deleted author's recipes", async () => {
      const author = await createTestUser(tx);
      const [recipe] = await tx
        .insert(communityRecipes)
        .values({
          authorId: author.id,
          normalizedProductName: "test",
          title: "Author's stew",
          instructions: ["Cook"],
          ingredients: [],
        })
        .returning();
      await tx.insert(savedItems).values({
        userId: testUser.id,
        type: "recipe",
        title: "Author's stew",
        recipeId: recipe.id,
        recipeType: "community",
      });
      await tx.insert(recipeDismissals).values({
        userId: testUser.id,
        recipeIdentifier: String(recipe.id),
        source: "community",
      });

      expect(await deleteUser(author.id)).toBe(true);

      const saved = await tx
        .select()
        .from(savedItems)
        .where(eq(savedItems.userId, testUser.id));
      const dismissed = await tx
        .select()
        .from(recipeDismissals)
        .where(eq(recipeDismissals.userId, testUser.id));
      expect(saved).toHaveLength(0);
      expect(dismissed).toHaveLength(0);
    });
  });
  describe("deleteUser — barcode verification aggregates", () => {
    // verification_history cascades with the user, but the barcode's stored
    // level/count/consensus used to keep counting the deleted user's vote
    // (audit 2026-10-29 L-data-9). Deleting a user recomputes them.
    const nutrition = {
      calories: 100,
      protein: 5,
      totalCarbs: 10,
      totalFat: 2,
    };
    let seq = 0;
    const newBarcode = () =>
      `98${Date.now() % 100_000_000}${++seq}`.slice(0, 13);

    async function seedVerified(barcode: string, voters: string[]) {
      await tx.insert(barcodeVerifications).values({
        barcode,
        verificationLevel: "verified",
        verificationCount: voters.length,
        consensusNutritionData: {
          calories: 100,
          protein: 5,
          carbs: 10,
          fat: 2,
        },
      });
      for (const userId of voters) {
        await tx.insert(verificationHistory).values({
          barcode,
          userId,
          extractedNutrition: nutrition,
          ocrConfidence: "0.90",
          isMatch: true,
        });
      }
    }

    it("drops the deleted voter from the count and demotes the level when consensus is lost", async () => {
      const [a, b, c] = [
        await createTestUser(tx),
        await createTestUser(tx),
        await createTestUser(tx),
      ];
      const barcode = newBarcode();
      await seedVerified(barcode, [a.id, b.id, c.id]);

      expect(await deleteUser(a.id)).toBe(true);

      const [row] = await tx
        .select()
        .from(barcodeVerifications)
        .where(eq(barcodeVerifications.barcode, barcode));
      expect(row.verificationCount).toBe(2);
      expect(row.verificationLevel).toBe("single_verified");
      expect(row.consensusNutritionData).toBeNull();
    });

    it("keeps a barcode verified when enough other voters remain", async () => {
      const voters = [
        await createTestUser(tx),
        await createTestUser(tx),
        await createTestUser(tx),
        await createTestUser(tx),
      ];
      const barcode = newBarcode();
      await seedVerified(
        barcode,
        voters.map((v) => v.id),
      );

      expect(await deleteUser(voters[0].id)).toBe(true);

      const [row] = await tx
        .select()
        .from(barcodeVerifications)
        .where(eq(barcodeVerifications.barcode, barcode));
      expect(row.verificationCount).toBe(3);
      expect(row.verificationLevel).toBe("verified");
      expect(row.consensusNutritionData).not.toBeNull();
    });

    it("resets a barcode to unverified when the deleted user was the only voter", async () => {
      const only = await createTestUser(tx);
      const barcode = newBarcode();
      await seedVerified(barcode, [only.id]);

      expect(await deleteUser(only.id)).toBe(true);

      const [row] = await tx
        .select()
        .from(barcodeVerifications)
        .where(eq(barcodeVerifications.barcode, barcode));
      expect(row.verificationCount).toBe(0);
      expect(row.verificationLevel).toBe("unverified");
      expect(row.consensusNutritionData).toBeNull();
    });

    it("leaves barcodes the user never voted on untouched", async () => {
      const voter = await createTestUser(tx);
      const other = await createTestUser(tx);
      const barcode = newBarcode();
      await seedVerified(barcode, [voter.id]);

      expect(await deleteUser(other.id)).toBe(true);

      const [row] = await tx
        .select()
        .from(barcodeVerifications)
        .where(eq(barcodeVerifications.barcode, barcode));
      expect(row.verificationCount).toBe(1);
      expect(row.verificationLevel).toBe("verified");
    });

    it("deletes a user past the lock threshold and recomputes in follow-up batches", async () => {
      // Holding one advisory lock per barcode until commit can exhaust the
      // shared lock table and roll the deletion back. Past the threshold the
      // user row goes first, then aggregates are recomputed in batches.
      const voter = await createTestUser(tx);
      const stamp = Date.now() % 1_000_000;
      const barcodes = Array.from(
        { length: DELETE_USER_LOCK_THRESHOLD + 1 },
        (_, i) =>
          `97${String(stamp).padStart(6, "0")}${String(i).padStart(5, "0")}`,
      );
      await tx.insert(barcodeVerifications).values(
        barcodes.map((barcode) => ({
          barcode,
          verificationLevel: "single_verified",
          verificationCount: 1,
        })),
      );
      await tx.insert(verificationHistory).values(
        barcodes.map((barcode) => ({
          barcode,
          userId: voter.id,
          extractedNutrition: nutrition,
          ocrConfidence: "0.90",
          isMatch: true,
        })),
      );
      const transaction = vi.spyOn(tx, "transaction");

      expect(await deleteUser(voter.id)).toBe(true);

      expect(transaction).toHaveBeenCalledTimes(
        1 + Math.ceil(barcodes.length / DELETE_USER_LOCK_THRESHOLD),
      );
      transaction.mockRestore();
      const rows = await tx
        .select()
        .from(barcodeVerifications)
        .where(
          inArray(barcodeVerifications.barcode, [
            barcodes[0],
            barcodes.at(-1)!,
          ]),
        );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.verificationCount).toBe(0);
        expect(row.verificationLevel).toBe("unverified");
      }
    });
  });
});
