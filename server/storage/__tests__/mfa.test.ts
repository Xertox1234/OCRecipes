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
  mfaChallenges,
  mfaEmailCodes,
  mfaTrustedDevices,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const mfa = await import("../mfa");
const me = await import("../mfa-email");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;
let otherUser: schema.User;

// All queries share the one test transaction (one connection), so the
// "concurrent" cases below serialise; they pin that the SQL guard admits
// exactly one winner, not true parallelism (the itest covers real requests).
async function enrolled(userId: string) {
  await me.issueMfaEmailCode(userId, "setup");
  await me.enableEmailMfa(userId, "setup");
}

/** A fresh code, past the resend cooldown (now() is fixed in the tx). */
async function freshCode(userId: string, hash: string) {
  await tx
    .update(mfaEmailCodes)
    .set({ lastSentAt: sql`now() - interval '31 seconds'` })
    .where(eq(mfaEmailCodes.userId, userId));
  await me.issueMfaEmailCode(userId, hash);
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

  it("every 10th failure locks and trips exactly once; the count keeps going", async () => {
    await enrolled(testUser.id);
    const unlock = () =>
      tx.execute(
        sql`UPDATE user_mfa SET locked_until = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
      );
    const trips: boolean[] = [];
    for (let i = 1; i <= 10; i++)
      trips.push((await mfa.recordMfaFailure(testUser.id)).tripped);
    // Auth audit 2026-10-10 L10: a lock refuses without counting — failures
    // recorded while locked never advance the count.
    for (let i = 0; i < 5; i++)
      expect((await mfa.recordMfaFailure(testUser.id)).tripped).toBe(false);
    expect((await me.getMfaState(testUser.id))!.failedAttempts).toBe(10);
    await unlock();
    for (let i = 11; i <= 20; i++)
      trips.push((await mfa.recordMfaFailure(testUser.id)).tripped);
    expect(trips.map((t, i) => (t ? i + 1 : 0)).filter(Boolean)).toEqual([
      10, 20,
    ]);
    expect((await me.getMfaState(testUser.id))!.failedAttempts).toBe(20);
    expect((await me.getMfaState(testUser.id))!.locked).toBe(true);
    await freshCode(testUser.id, "c1");
    expect(await me.acceptMfaEmailCode(testUser.id, "c1")).toBe(false);
    await unlock();
    expect(await me.acceptMfaEmailCode(testUser.id, "c1")).toBe(true);
    expect((await me.getMfaState(testUser.id))!.failedAttempts).toBe(0);
  });

  it("a concurrent burst stops counting at the lock", async () => {
    await enrolled(testUser.id);
    await Promise.all(
      Array.from({ length: 30 }, () => mfa.recordMfaFailure(testUser.id)),
    );
    expect((await me.getMfaState(testUser.id))!.failedAttempts).toBe(10);
  });

  it("10 concurrent failures trip the lock exactly once", async () => {
    await enrolled(testUser.id);
    const r = await Promise.all(
      Array.from({ length: 10 }, () => mfa.recordMfaFailure(testUser.id)),
    );
    expect(r.filter((x) => x.tripped)).toHaveLength(1);
  });

  it("disableMfa clears every MFA row and bumps tokenVersion", async () => {
    await enrolled(testUser.id);
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
      mfaChallenges,
      mfaTrustedDevices,
      mfaEmailCodes,
    ]) {
      const rows = await tx
        .select()
        .from(table)
        .where(eq(table.userId, testUser.id));
      expect(rows).toHaveLength(0);
    }
    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.mfaEnabledAt).toBeNull();
    // The password is untouched.
    expect(u.password).toBe(testUser.password);
  });

  it("disableMfa with clearPendingEmail (the manual reset): drops a staged email, keeps the password", async () => {
    await enrolled(testUser.id);
    await tx
      .update(users)
      .set({ pendingEmail: "staged@example.com" })
      .where(eq(users.id, testUser.id));
    const v = await mfa.disableMfa(testUser.id, { clearPendingEmail: true });
    expect(v).toBe(testUser.tokenVersion + 2);
    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.pendingEmail).toBeNull();
    expect(u.password).toBe(testUser.password);
    expect(u.mfaEnabledAt).toBeNull();
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
