import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
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
  mfaChallenges,
  mfaEmailCodes,
  mfaTrustedDevices,
  userMfa,
  users,
} from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const me = await import("../mfa-email");
const mfa = await import("../mfa");

let tx: NodePgDatabase<typeof schema>;

/** now() is fixed inside the test transaction: step the cooldown back by hand. */
async function pastCooldown(userId: string) {
  await tx
    .update(mfaEmailCodes)
    .set({ lastSentAt: sql`now() - interval '31 seconds'` })
    .where(eq(mfaEmailCodes.userId, userId));
}

describe("two-step email codes (real DB)", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("issues a code; a second one inside 30 s is refused as cooldown", async () => {
    const user = await createTestUser(tx);
    expect(await me.issueMfaEmailCode(user.id, "h1")).toBe("issued");
    expect(await me.issueMfaEmailCode(user.id, "h2")).toBe("cooldown");
    expect(await me.reserveMfaEmailAttempt(user.id)).toBe("h1");
  });

  it("10 codes per window, then capped; a new window starts again at 1", async () => {
    const user = await createTestUser(tx);
    for (let i = 0; i < 10; i++) {
      expect(await me.issueMfaEmailCode(user.id, `h${i}`)).toBe("issued");
      await pastCooldown(user.id);
    }
    expect(await me.issueMfaEmailCode(user.id, "h10")).toBe("capped");
    await tx
      .update(mfaEmailCodes)
      .set({ windowStart: sql`now() - interval '25 hours'` })
      .where(eq(mfaEmailCodes.userId, user.id));
    expect(await me.issueMfaEmailCode(user.id, "h11")).toBe("issued");
    const [row] = await tx
      .select()
      .from(mfaEmailCodes)
      .where(eq(mfaEmailCodes.userId, user.id));
    expect(row.issueCount).toBe(1);
  });

  it("reserve counts each guess; the 6th is refused", async () => {
    const user = await createTestUser(tx);
    await me.issueMfaEmailCode(user.id, "h1");
    for (let i = 0; i < 5; i++)
      expect(await me.reserveMfaEmailAttempt(user.id)).toBe("h1");
    expect(await me.reserveMfaEmailAttempt(user.id)).toBeUndefined();
  });

  it("an expired code is not reservable", async () => {
    const user = await createTestUser(tx);
    await me.issueMfaEmailCode(user.id, "h1");
    await tx
      .update(mfaEmailCodes)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(mfaEmailCodes.userId, user.id));
    expect(await me.reserveMfaEmailAttempt(user.id)).toBeUndefined();
  });

  it("a new code replaces the live one and resets its guesses", async () => {
    const user = await createTestUser(tx);
    await me.issueMfaEmailCode(user.id, "h1");
    for (let i = 0; i < 5; i++) await me.reserveMfaEmailAttempt(user.id);
    await pastCooldown(user.id);
    await me.issueMfaEmailCode(user.id, "h2");
    expect(await me.reserveMfaEmailAttempt(user.id)).toBe("h2");
  });

  it("enableEmailMfa: spends the code, turns two-step on, version+1", async () => {
    const user = await createTestUser(tx);
    await me.issueMfaEmailCode(user.id, "h1");
    const v = await me.enableEmailMfa(user.id, "h1");
    expect(v).toBe(user.tokenVersion + 1);
    const [u] = await tx.select().from(users).where(eq(users.id, user.id));
    expect(u.mfaEnabledAt).not.toBeNull();
    const [m] = await tx
      .select()
      .from(userMfa)
      .where(eq(userMfa.userId, user.id));
    expect(m.failedAttempts).toBe(0);
    expect(await me.reserveMfaEmailAttempt(user.id)).toBeUndefined();
  });

  it("enableEmailMfa clears a stale row's failures and lock", async () => {
    const user = await createTestUser(tx);
    await tx.insert(userMfa).values({
      userId: user.id,
      failedAttempts: 7,
      lockedUntil: sql`now() + interval '5 minutes'`,
    });
    await me.issueMfaEmailCode(user.id, "h1");
    expect(await me.enableEmailMfa(user.id, "h1")).toBe(user.tokenVersion + 1);
    const [m] = await tx
      .select()
      .from(userMfa)
      .where(eq(userMfa.userId, user.id));
    expect(m.failedAttempts).toBe(0);
    expect(m.lockedUntil).toBeNull();
  });

  it("enableEmailMfa refuses when two-step is already on — nothing written", async () => {
    const user = await createTestUser(tx);
    await tx
      .update(users)
      .set({ mfaEnabledAt: new Date() })
      .where(eq(users.id, user.id));
    await me.issueMfaEmailCode(user.id, "h1");
    expect(await me.enableEmailMfa(user.id, "h1")).toBeUndefined();
    expect(await me.reserveMfaEmailAttempt(user.id)).toBe("h1"); // not spent
  });

  it("enableEmailMfa refuses a code already spent or replaced", async () => {
    const user = await createTestUser(tx);
    await me.issueMfaEmailCode(user.id, "h1");
    await pastCooldown(user.id);
    await me.issueMfaEmailCode(user.id, "h2");
    expect(await me.enableEmailMfa(user.id, "h1")).toBeUndefined();
    const [u] = await tx.select().from(users).where(eq(users.id, user.id));
    expect(u.mfaEnabledAt).toBeNull();
  });

  async function emailAccount() {
    const user = await createTestUser(tx);
    await me.issueMfaEmailCode(user.id, "setup");
    await me.enableEmailMfa(user.id, "setup");
    await pastCooldown(user.id);
    return user;
  }

  it("getMfaState reports the failure state only while two-step is on", async () => {
    const email = await emailAccount();
    expect(await me.getMfaState(email.id)).toEqual({
      failedAttempts: 0,
      locked: false,
    });
    // A leftover row on an account with two-step off is not active.
    const off = await createTestUser(tx);
    await tx.insert(userMfa).values({ userId: off.id });
    expect(await me.getMfaState(off.id)).toBeUndefined();
  });

  it("acceptMfaEmailCode spends the code once and clears the failure count", async () => {
    const user = await emailAccount();
    await mfa.recordMfaFailure(user.id);
    await me.issueMfaEmailCode(user.id, "h1");
    expect(await me.acceptMfaEmailCode(user.id, "h1")).toBe(true);
    expect(await me.acceptMfaEmailCode(user.id, "h1")).toBe(false);
    expect((await me.getMfaState(user.id))?.failedAttempts).toBe(0);
  });

  it("acceptMfaEmailCode is refused while locked", async () => {
    const user = await emailAccount();
    await me.issueMfaEmailCode(user.id, "h1");
    await tx
      .update(userMfa)
      .set({ lockedUntil: sql`now() + interval '10 minutes'` })
      .where(eq(userMfa.userId, user.id));
    expect(await me.acceptMfaEmailCode(user.id, "h1")).toBe(false);
  });

  it("disableMfa removes the email code row too", async () => {
    const user = await emailAccount();
    await me.issueMfaEmailCode(user.id, "h1");
    await mfa.disableMfa(user.id);
    const rows = await tx
      .select()
      .from(mfaEmailCodes)
      .where(eq(mfaEmailCodes.userId, user.id));
    expect(rows).toHaveLength(0);
    expect(await me.getMfaState(user.id)).toBeUndefined();
  });

  it("getLiveMfaChallenge reads without spending an attempt", async () => {
    const user = await createTestUser(tx);
    await mfa.createMfaChallenge({
      tokenHash: "t1",
      userId: user.id,
      tokenVersion: user.tokenVersion,
      purpose: "login",
    });
    expect((await me.getLiveMfaChallenge("t1"))?.userId).toBe(user.id);
    const [row] = await tx
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.tokenHash, "t1"));
    expect(row.attempts).toBe(0);
    await tx
      .update(mfaChallenges)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(mfaChallenges.tokenHash, "t1"));
    expect(await me.getLiveMfaChallenge("t1")).toBeUndefined();
  });

  it("an email challenge lives as long as its code (10 minutes)", async () => {
    const user = await createTestUser(tx);
    await mfa.createMfaChallenge({
      tokenHash: "t2",
      userId: user.id,
      tokenVersion: user.tokenVersion,
      purpose: "login",
    });
    const [row] = await tx
      .select({
        mins: sql<number>`round(extract(epoch from (${mfaChallenges.expiresAt} - now())) / 60)`,
      })
      .from(mfaChallenges)
      .where(eq(mfaChallenges.tokenHash, "t2"));
    expect(Number(row.mins)).toBe(10);
  });

  it("deleting the user removes the email code row", async () => {
    const user = await createTestUser(tx);
    await me.issueMfaEmailCode(user.id, "h1");
    await tx.delete(users).where(eq(users.id, user.id));
    const rows = await tx
      .select()
      .from(mfaEmailCodes)
      .where(eq(mfaEmailCodes.userId, user.id));
    expect(rows).toHaveLength(0);
  });

  it("trusted phones survive turning email two-step on (none exist yet) and are untouched by codes", async () => {
    const user = await emailAccount();
    await tx.insert(mfaTrustedDevices).values({
      userId: user.id,
      keyHash: `k-${user.id}`,
      expiresAt: sql`now() + interval '30 days'`,
    });
    await me.issueMfaEmailCode(user.id, "h1");
    await me.acceptMfaEmailCode(user.id, "h1");
    const phones = await tx
      .select()
      .from(mfaTrustedDevices)
      .where(eq(mfaTrustedDevices.userId, user.id));
    expect(phones).toHaveLength(1);
  });
});
