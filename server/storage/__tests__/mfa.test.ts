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
import type * as schema from "@shared/schema";
import {
  users,
  userMfa,
  mfaRecoveryCodes,
  mfaChallenges,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const mfa = await import("../mfa");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;
let otherUser: schema.User;

async function confirmEnrolled(
  userId: string,
  acceptedStep: number,
  recoveryHashes: string[] = ["h0"],
) {
  await mfa.startTotpEnrollment(userId, "enc-secret");
  const v = await mfa.confirmTotpEnrollment(userId, {
    acceptedStep,
    recoveryHashes,
  });
  if (v === undefined) throw new Error("enrollment did not confirm");
  return v;
}

async function readUser(id: string) {
  const [u] = await tx.select().from(users).where(eq(users.id, id));
  return u;
}

describe("MFA storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
    otherUser = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("enrollment", () => {
    it("a pending secret is readable until confirmed, then gone", async () => {
      await mfa.startTotpEnrollment(testUser.id, "enc-a");
      expect(await mfa.getPendingTotpSecret(testUser.id)).toBe("enc-a");
      expect(await mfa.getPendingTotpSecret(otherUser.id)).toBeUndefined();
      await mfa.confirmTotpEnrollment(testUser.id, {
        acceptedStep: 5,
        recoveryHashes: ["a"],
      });
      expect(await mfa.getPendingTotpSecret(testUser.id)).toBeUndefined();
    });

    it("starting again replaces the pending secret", async () => {
      await mfa.startTotpEnrollment(testUser.id, "enc-a");
      await mfa.startTotpEnrollment(testUser.id, "enc-b");
      expect(await mfa.getPendingTotpSecret(testUser.id)).toBe("enc-b");
    });

    it("confirm bumps tokenVersion, sets mfa_enabled_at, stores codes; a second confirm is a no-op", async () => {
      const before = testUser.tokenVersion;
      await mfa.startTotpEnrollment(testUser.id, "enc-a");
      expect(
        await mfa.confirmTotpEnrollment(testUser.id, {
          acceptedStep: 5,
          recoveryHashes: ["a", "b"],
        }),
      ).toBe(before + 1);
      expect(
        await mfa.confirmTotpEnrollment(testUser.id, {
          acceptedStep: 6,
          recoveryHashes: ["c"],
        }),
      ).toBeUndefined();
      const u = await readUser(testUser.id);
      expect(u.mfaEnabledAt).not.toBeNull();
      expect(u.tokenVersion).toBe(before + 1);
      expect(await mfa.countRecoveryCodes(testUser.id)).toBe(2);
      const active = await mfa.getActiveTotp(testUser.id);
      expect(active).toMatchObject({
        secretEnc: "enc-a",
        lastStep: 5,
        failedAttempts: 0,
        locked: false,
      });
    });

    it("an expired pending secret cannot be read or confirmed", async () => {
      await mfa.startTotpEnrollment(testUser.id, "enc-a");
      await tx
        .update(userMfa)
        .set({ pendingExpiresAt: sql`now() - interval '1 second'` })
        .where(eq(userMfa.userId, testUser.id));
      expect(await mfa.getPendingTotpSecret(testUser.id)).toBeUndefined();
      expect(
        await mfa.confirmTotpEnrollment(testUser.id, {
          acceptedStep: 5,
          recoveryHashes: ["a"],
        }),
      ).toBeUndefined();
      expect((await readUser(testUser.id)).mfaEnabledAt).toBeNull();
    });

    it("another user's pending secret is never confirmed", async () => {
      await mfa.startTotpEnrollment(testUser.id, "enc-a");
      expect(
        await mfa.confirmTotpEnrollment(otherUser.id, {
          acceptedStep: 5,
          recoveryHashes: ["a"],
        }),
      ).toBeUndefined();
      expect(await mfa.getActiveTotp(otherUser.id)).toBeUndefined();
    });
  });

  describe("TOTP step replay guard", () => {
    it("accepts a later step once, refuses the same or an older step", async () => {
      await confirmEnrolled(testUser.id, 100);
      expect(await mfa.acceptTotpStep(testUser.id, 100)).toBe(false);
      expect(await mfa.acceptTotpStep(testUser.id, 99)).toBe(false);
      expect(await mfa.acceptTotpStep(testUser.id, 101)).toBe(true);
      expect(await mfa.acceptTotpStep(testUser.id, 101)).toBe(false);
    });

    it("two accepts of the same step at once: exactly one wins", async () => {
      await confirmEnrolled(testUser.id, 100);
      const r = await Promise.all([
        mfa.acceptTotpStep(testUser.id, 101),
        mfa.acceptTotpStep(testUser.id, 101),
      ]);
      expect(r.filter(Boolean)).toHaveLength(1);
    });

    it("another user's step is never advanced", async () => {
      await confirmEnrolled(testUser.id, 100);
      expect(await mfa.acceptTotpStep(otherUser.id, 101)).toBe(false);
      expect((await mfa.getActiveTotp(testUser.id))!.lastStep).toBe(100);
    });
  });

  describe("failures and lockout", () => {
    it("every 10th failure locks; a lock refuses acceptTotpStep until it lapses; success resets", async () => {
      await confirmEnrolled(testUser.id, 100);
      for (let i = 1; i <= 9; i++) {
        expect(await mfa.recordMfaFailure(testUser.id)).toBe(i);
      }
      expect((await mfa.getActiveTotp(testUser.id))!.locked).toBe(false);
      expect(await mfa.recordMfaFailure(testUser.id)).toBe(10);
      expect((await mfa.getActiveTotp(testUser.id))!.locked).toBe(true);
      expect(await mfa.acceptTotpStep(testUser.id, 200)).toBe(false);

      await tx
        .update(userMfa)
        .set({ lockedUntil: sql`now() - interval '1 second'` })
        .where(eq(userMfa.userId, testUser.id));
      expect(await mfa.acceptTotpStep(testUser.id, 200)).toBe(true);
      const after = await mfa.getActiveTotp(testUser.id);
      expect(after!.failedAttempts).toBe(0);
      expect(after!.locked).toBe(false);
    });

    it("the 11th failure does not lock again; the 20th does", async () => {
      await confirmEnrolled(testUser.id, 100);
      await tx
        .update(userMfa)
        .set({ failedAttempts: 10, lockedUntil: null })
        .where(eq(userMfa.userId, testUser.id));
      expect(await mfa.recordMfaFailure(testUser.id)).toBe(11);
      expect((await mfa.getActiveTotp(testUser.id))!.locked).toBe(false);
      await tx
        .update(userMfa)
        .set({ failedAttempts: 19 })
        .where(eq(userMfa.userId, testUser.id));
      expect(await mfa.recordMfaFailure(testUser.id)).toBe(20);
      expect((await mfa.getActiveTotp(testUser.id))!.locked).toBe(true);
    });

    it("a failure for an account without MFA records nothing", async () => {
      expect(await mfa.recordMfaFailure(otherUser.id)).toBe(0);
    });
  });

  describe("recovery codes", () => {
    it("a code works once and is replaced", async () => {
      await confirmEnrolled(testUser.id, 100, ["h1", "h2"]);
      expect(await mfa.consumeRecoveryCode(testUser.id, "h1", "h3")).toBe(true);
      expect(await mfa.consumeRecoveryCode(testUser.id, "h1", "h4")).toBe(
        false,
      );
      const rows = await tx
        .select({ h: mfaRecoveryCodes.codeHash })
        .from(mfaRecoveryCodes)
        .where(eq(mfaRecoveryCodes.userId, testUser.id));
      expect(rows.map((r) => r.h).sort()).toEqual(["h2", "h3"]);
    });

    it("a good code resets the failure count and lock", async () => {
      await confirmEnrolled(testUser.id, 100, ["h1"]);
      await tx
        .update(userMfa)
        .set({
          failedAttempts: 100,
          lockedUntil: sql`now() - interval '1 second'`,
        })
        .where(eq(userMfa.userId, testUser.id));
      expect(await mfa.consumeRecoveryCode(testUser.id, "h1", "h2")).toBe(true);
      expect((await mfa.getActiveTotp(testUser.id))!.failedAttempts).toBe(0);
    });

    it("another user's code is never consumed", async () => {
      await confirmEnrolled(testUser.id, 100, ["h1"]);
      await confirmEnrolled(otherUser.id, 100, ["o1"]);
      expect(await mfa.consumeRecoveryCode(otherUser.id, "h1", "x")).toBe(
        false,
      );
      expect(await mfa.countRecoveryCodes(testUser.id)).toBe(1);
      expect(await mfa.countRecoveryCodes(otherUser.id)).toBe(1);
    });

    it("replaceRecoveryCodes swaps the whole set", async () => {
      await confirmEnrolled(testUser.id, 100, ["h1", "h2"]);
      await mfa.replaceRecoveryCodes(testUser.id, ["n1", "n2", "n3"]);
      expect(await mfa.countRecoveryCodes(testUser.id)).toBe(3);
      expect(await mfa.consumeRecoveryCode(testUser.id, "h1", "x")).toBe(false);
    });
  });

  describe("disable", () => {
    it("clears every MFA row, mfa_enabled_at and bumps tokenVersion", async () => {
      const v = await confirmEnrolled(testUser.id, 100, ["h1"]);
      await mfa.createMfaChallenge({
        tokenHash: "t",
        userId: testUser.id,
        tokenVersion: v,
        purpose: "login",
      });
      expect(await mfa.disableMfa(testUser.id)).toBe(v + 1);
      const u = await readUser(testUser.id);
      expect(u.mfaEnabledAt).toBeNull();
      expect(u.tokenVersion).toBe(v + 1);
      expect(await mfa.getActiveTotp(testUser.id)).toBeUndefined();
      expect(await mfa.countRecoveryCodes(testUser.id)).toBe(0);
      expect(
        await tx
          .select()
          .from(mfaChallenges)
          .where(eq(mfaChallenges.userId, testUser.id)),
      ).toHaveLength(0);
    });

    it("disabling an account without MFA changes nothing", async () => {
      expect(await mfa.disableMfa(otherUser.id)).toBeUndefined();
      expect((await readUser(otherUser.id)).tokenVersion).toBe(
        otherUser.tokenVersion,
      );
    });
  });

  describe("challenges", () => {
    it("5 reservations then refused; consume works once", async () => {
      await mfa.createMfaChallenge({
        tokenHash: "t",
        userId: testUser.id,
        tokenVersion: 0,
        purpose: "login",
      });
      for (let i = 0; i < 5; i++) {
        expect(await mfa.reserveMfaChallengeAttempt("t")).toMatchObject({
          userId: testUser.id,
          purpose: "login",
          attempts: i + 1,
        });
      }
      expect(await mfa.reserveMfaChallengeAttempt("t")).toBeUndefined();
      expect(await mfa.consumeMfaChallenge("t")).toBe(true);
      expect(await mfa.consumeMfaChallenge("t")).toBe(false);
    });

    it("an expired challenge is refused", async () => {
      await mfa.createMfaChallenge({
        tokenHash: "t",
        userId: testUser.id,
        tokenVersion: 0,
        purpose: "login",
      });
      await tx
        .update(mfaChallenges)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(mfaChallenges.tokenHash, "t"));
      expect(await mfa.reserveMfaChallengeAttempt("t")).toBeUndefined();
    });

    it("a link challenge keeps the ticket hash and email flag", async () => {
      await mfa.createMfaChallenge({
        tokenHash: "t",
        userId: testUser.id,
        tokenVersion: 3,
        purpose: "link",
        linkTicketHash: "ticket-hash",
        linkMarkEmailVerified: true,
      });
      expect(await mfa.reserveMfaChallengeAttempt("t")).toMatchObject({
        tokenVersion: 3,
        purpose: "link",
        linkTicketHash: "ticket-hash",
        linkMarkEmailVerified: true,
      });
    });

    it("creating a challenge sweeps that user's expired ones only", async () => {
      await mfa.createMfaChallenge({
        tokenHash: "old",
        userId: testUser.id,
        tokenVersion: 0,
        purpose: "login",
      });
      await mfa.createMfaChallenge({
        tokenHash: "other-old",
        userId: otherUser.id,
        tokenVersion: 0,
        purpose: "login",
      });
      await tx
        .update(mfaChallenges)
        .set({ expiresAt: sql`now() - interval '1 second'` });
      await mfa.createMfaChallenge({
        tokenHash: "new",
        userId: testUser.id,
        tokenVersion: 0,
        purpose: "login",
      });
      const left = await tx
        .select({ h: mfaChallenges.tokenHash })
        .from(mfaChallenges);
      expect(left.map((r) => r.h).sort()).toEqual(["new", "other-old"]);
    });
  });
});
