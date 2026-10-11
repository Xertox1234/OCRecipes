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
  mfaTrustedDevices,
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

// All queries share the one test transaction (one connection), so the
// "concurrent" cases below serialise; they pin that the SQL guard admits
// exactly one winner, not true parallelism (the itest covers real requests).
async function confirmEnrolled(
  userId: string,
  step: number,
  hashes: string[] = ["h1", "h2"],
) {
  await mfa.startTotpEnrollment(userId, "enc");
  await mfa.confirmTotpEnrollment(userId, {
    acceptedStep: step,
    recoveryHashes: hashes,
  });
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

  it("acceptTotpStep accepts a step once and refuses it (and older) after", async () => {
    await confirmEnrolled(testUser.id, 100);
    expect(await mfa.acceptTotpStep(testUser.id, 100)).toBe(false);
    expect(await mfa.acceptTotpStep(testUser.id, 99)).toBe(false);
    expect(await mfa.acceptTotpStep(testUser.id, 101)).toBe(true);
    expect(await mfa.acceptTotpStep(testUser.id, 101)).toBe(false);
  });

  it("two concurrent accepts of the same step: exactly one wins", async () => {
    await confirmEnrolled(testUser.id, 100);
    const r = await Promise.all([
      mfa.acceptTotpStep(testUser.id, 101),
      mfa.acceptTotpStep(testUser.id, 101),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it("every 10th failure locks and trips exactly once; the count keeps going", async () => {
    await confirmEnrolled(testUser.id, 100);
    const unlock = () =>
      tx.execute(
        sql`UPDATE user_mfa SET locked_until = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
      );
    const trips: boolean[] = [];
    for (let i = 1; i <= 10; i++)
      trips.push((await mfa.recordMfaFailure(testUser.id)).tripped);
    // Auth audit 2026-10-10 L10: a lock refuses without counting — failures
    // recorded while locked never advance the count toward the 100 cap.
    for (let i = 0; i < 5; i++)
      expect((await mfa.recordMfaFailure(testUser.id)).tripped).toBe(false);
    expect((await mfa.getActiveTotp(testUser.id))!.failedAttempts).toBe(10);
    await unlock();
    for (let i = 11; i <= 20; i++)
      trips.push((await mfa.recordMfaFailure(testUser.id)).tripped);
    expect(trips.map((t, i) => (t ? i + 1 : 0)).filter(Boolean)).toEqual([
      10, 20,
    ]);
    expect((await mfa.getActiveTotp(testUser.id))!.failedAttempts).toBe(20);
    expect((await mfa.getActiveTotp(testUser.id))!.locked).toBe(true);
    expect(await mfa.acceptTotpStep(testUser.id, 200)).toBe(false);
    await tx.execute(
      sql`UPDATE user_mfa SET locked_until = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
    );
    expect(await mfa.acceptTotpStep(testUser.id, 200)).toBe(true);
    expect((await mfa.getActiveTotp(testUser.id))!.failedAttempts).toBe(0);
  });

  it("a concurrent burst stops counting at the lock (cannot race toward the cap)", async () => {
    await confirmEnrolled(testUser.id, 100);
    await Promise.all(
      Array.from({ length: 30 }, () => mfa.recordMfaFailure(testUser.id)),
    );
    expect((await mfa.getActiveTotp(testUser.id))!.failedAttempts).toBe(10);
  });

  it("10 concurrent failures trip the lock exactly once", async () => {
    await confirmEnrolled(testUser.id, 100);
    const r = await Promise.all(
      Array.from({ length: 10 }, () => mfa.recordMfaFailure(testUser.id)),
    );
    expect(r.filter((x) => x.tripped)).toHaveLength(1);
  });

  it("a recovery code works once and is replaced; concurrent redemption: one wins", async () => {
    await confirmEnrolled(testUser.id, 100, ["h1", "h2"]);
    const r = await Promise.all([
      mfa.consumeRecoveryCode(testUser.id, "h1", "h3"),
      mfa.consumeRecoveryCode(testUser.id, "h1", "h4"),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
    const rows = await tx
      .select()
      .from(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, testUser.id));
    expect(rows).toHaveLength(2); // h2 + exactly one replacement
  });

  it("confirm bumps tokenVersion and sets mfa_enabled_at; a second confirm is a no-op", async () => {
    const before = testUser.tokenVersion;
    await mfa.startTotpEnrollment(testUser.id, "enc");
    expect(
      await mfa.confirmTotpEnrollment(testUser.id, {
        acceptedStep: 5,
        recoveryHashes: ["a"],
      }),
    ).toBe(before + 1);
    await mfa.startTotpEnrollment(testUser.id, "enc2");
    expect(
      await mfa.confirmTotpEnrollment(testUser.id, {
        acceptedStep: 6,
        recoveryHashes: ["b"],
      }),
    ).toBeUndefined();
    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.mfaEnabledAt).not.toBeNull();
  });

  it("a locked account's pending secret is unavailable until the lock ends (audit L9)", async () => {
    await mfa.startTotpEnrollment(testUser.id, "enc");
    for (let i = 0; i < 10; i++) await mfa.recordMfaFailure(testUser.id);
    expect(await mfa.getPendingTotpSecret(testUser.id)).toBeUndefined();
    await tx.execute(
      sql`UPDATE user_mfa SET locked_until = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
    );
    expect(await mfa.getPendingTotpSecret(testUser.id)).toBe("enc");
  });

  it("an expired pending secret cannot be confirmed", async () => {
    await mfa.startTotpEnrollment(testUser.id, "enc");
    await tx.execute(
      sql`UPDATE user_mfa SET pending_expires_at = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
    );
    expect(
      await mfa.confirmTotpEnrollment(testUser.id, {
        acceptedStep: 5,
        recoveryHashes: ["a"],
      }),
    ).toBeUndefined();
    expect(await mfa.getPendingTotpSecret(testUser.id)).toBeUndefined();
  });

  it("confirmNewPhone swaps the secret, keeps recovery codes, clears trusted devices, bumps version", async () => {
    await confirmEnrolled(testUser.id, 100, ["h1"]);
    await mfa.trustDevice(testUser.id, "k1");
    await mfa.startTotpEnrollment(testUser.id, "enc-new");
    const v = await mfa.confirmNewPhone(testUser.id, { acceptedStep: 300 });
    expect(v).toBe(testUser.tokenVersion + 2);
    expect((await mfa.getActiveTotp(testUser.id))!.secretEnc).toBe("enc-new");
    expect(await mfa.isTrustedDevice(testUser.id, "k1")).toBe(false);
    const codes = await tx
      .select()
      .from(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, testUser.id));
    expect(codes).toHaveLength(1);
  });

  it("confirmNewPhone refuses when MFA is off", async () => {
    await mfa.startTotpEnrollment(testUser.id, "enc");
    expect(
      await mfa.confirmNewPhone(testUser.id, { acceptedStep: 1 }),
    ).toBeUndefined();
  });

  it("disableMfa clears every MFA row and bumps tokenVersion", async () => {
    await confirmEnrolled(testUser.id, 100);
    await mfa.trustDevice(testUser.id, "k1");
    await mfa.createMfaChallenge({
      tokenHash: "t",
      userId: testUser.id,
      tokenVersion: 0,
      purpose: "login",
    });
    const v = await mfa.disableMfa(testUser.id);
    expect(v).toBe(testUser.tokenVersion + 2);
    for (const table of [
      userMfa,
      mfaRecoveryCodes,
      mfaChallenges,
      mfaTrustedDevices,
    ]) {
      const rows = await tx
        .select()
        .from(table)
        .where(eq(table.userId, testUser.id));
      expect(rows).toHaveLength(0);
    }
    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.mfaEnabledAt).toBeNull();
    // No new password given → the password and a staged email are untouched.
    expect(u.password).toBe(testUser.password);
  });

  it("disableMfa with a new password: changes it and drops a staged email in the same transaction", async () => {
    await confirmEnrolled(testUser.id, 100);
    await mfa.trustDevice(testUser.id, "k1");
    await tx
      .update(users)
      .set({ pendingEmail: "staged@example.com" })
      .where(eq(users.id, testUser.id));
    const v = await mfa.disableMfa(testUser.id, {
      newPasswordHash: "pv2$x",
    });
    expect(v).toBe(testUser.tokenVersion + 2);
    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.password).toBe("pv2$x");
    expect(u.pendingEmail).toBeNull();
    expect(u.mfaEnabledAt).toBeNull();
    const trusted = await tx
      .select()
      .from(mfaTrustedDevices)
      .where(eq(mfaTrustedDevices.userId, testUser.id));
    expect(trusted).toHaveLength(0);
  });

  it("challenge: 5 reservations then refused; consume once; concurrent consume: one wins", async () => {
    await mfa.createMfaChallenge({
      tokenHash: "t",
      userId: testUser.id,
      tokenVersion: 0,
      purpose: "login",
    });
    for (let i = 0; i < 5; i++)
      expect(await mfa.reserveMfaChallengeAttempt("t")).toBeDefined();
    expect(await mfa.reserveMfaChallengeAttempt("t")).toBeUndefined();
    const r = await Promise.all([
      mfa.consumeMfaChallenge("t"),
      mfa.consumeMfaChallenge("t"),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  it("a link challenge never outlives its notAfter", async () => {
    const notAfter = new Date(Date.now() + 60_000);
    await mfa.createMfaChallenge({
      tokenHash: "L",
      userId: testUser.id,
      tokenVersion: 0,
      purpose: "link",
      linkTicketHash: "th",
      notAfter,
    });
    const [row] = await tx
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.tokenHash, "L"));
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(notAfter.getTime());
  });

  it("trusted devices: per user, expire, and forget", async () => {
    await mfa.trustDevice(testUser.id, "k1");
    expect(await mfa.isTrustedDevice(testUser.id, "k1")).toBe(true);
    expect(await mfa.isTrustedDevice(otherUser.id, "k1")).toBe(false); // Review Focus 3
    await tx.execute(
      sql`UPDATE mfa_trusted_devices SET expires_at = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
    );
    expect(await mfa.isTrustedDevice(testUser.id, "k1")).toBe(false);
    await mfa.trustDevice(testUser.id, "k2"); // also purges the expired k1
    const rows = await tx
      .select()
      .from(mfaTrustedDevices)
      .where(eq(mfaTrustedDevices.userId, testUser.id));
    expect(rows.map((r) => r.keyHash)).toEqual(["k2"]);
    await mfa.forgetTrustedDevices(testUser.id);
    expect(await mfa.isTrustedDevice(testUser.id, "k2")).toBe(false);
  });
});
