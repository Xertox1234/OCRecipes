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
import { mfaTrustedDevices, passwordChangeCodes, users } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const pc = await import("../password-change");
const reset = await import("../password-reset");

let tx: NodePgDatabase<typeof schema>;

describe("password change codes (real DB)", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  // The spec's success criterion (§1): a stranger exhausting Forgot password
  // cannot block the signed-in path, and the reverse.
  it("an exhausted Forgot password cap does not block a change code", async () => {
    const user = await createTestUser(tx);
    let issued = 0;
    while (await reset.issuePasswordResetCode(user.id, `r${issued}`)) issued++;
    expect(issued).toBe(6);
    expect(await pc.issuePasswordChangeCode(user.id, "c1")).toBe(true);
  });

  it("an exhausted change-code cap does not block a Forgot password code", async () => {
    const user = await createTestUser(tx);
    for (let i = 0; i < 5; i++)
      expect(await pc.issuePasswordChangeCode(user.id, `c${i}`)).toBe(true);
    expect(await pc.issuePasswordChangeCode(user.id, "c5")).toBe(false);
    expect(await reset.issuePasswordResetCode(user.id, "r0")).toBe(true);
  });

  it("5 codes per window; once 24 h have passed, issuing starts again at 1", async () => {
    const user = await createTestUser(tx);
    for (let i = 0; i < 5; i++)
      await pc.issuePasswordChangeCode(user.id, `c${i}`);
    expect(await pc.issuePasswordChangeCode(user.id, "c5")).toBe(false);
    await tx
      .update(passwordChangeCodes)
      .set({ windowStart: sql`now() - interval '25 hours'` })
      .where(eq(passwordChangeCodes.userId, user.id));
    expect(await pc.issuePasswordChangeCode(user.id, "c6")).toBe(true);
    const [row] = await tx
      .select()
      .from(passwordChangeCodes)
      .where(eq(passwordChangeCodes.userId, user.id));
    expect(row.issueCount).toBe(1);
  });

  it("reserve returns the live hash and counts the guess; the 6th is refused", async () => {
    const user = await createTestUser(tx);
    await pc.issuePasswordChangeCode(user.id, "hash-1");
    for (let i = 0; i < 5; i++)
      expect(await pc.reservePasswordChangeAttempt(user.id)).toBe("hash-1");
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBeUndefined();
  });

  it("an expired code is not reservable", async () => {
    const user = await createTestUser(tx);
    await pc.issuePasswordChangeCode(user.id, "hash-1");
    await tx
      .update(passwordChangeCodes)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(passwordChangeCodes.userId, user.id));
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBeUndefined();
  });

  it("no code at all → undefined", async () => {
    const user = await createTestUser(tx);
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBeUndefined();
  });

  // Review Focus 2.
  it("a new code replaces the live one and resets its guesses", async () => {
    const user = await createTestUser(tx);
    await pc.issuePasswordChangeCode(user.id, "hash-1");
    for (let i = 0; i < 5; i++) await pc.reservePasswordChangeAttempt(user.id);
    await pc.issuePasswordChangeCode(user.id, "hash-2");
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBe("hash-2");
  });

  async function seed() {
    const user = await createTestUser(tx);
    await tx
      .update(users)
      .set({
        pendingEmail: "staged@example.com",
        resetCodeHash: "live-reset",
        resetCodeExpiresAt: sql`now() + interval '10 minutes'`,
      })
      .where(eq(users.id, user.id));
    await tx.insert(mfaTrustedDevices).values({
      userId: user.id,
      keyHash: `k-${user.id}`,
      expiresAt: sql`now() + interval '30 days'`,
    });
    return user;
  }

  it("changePassword: new hash, version+1, staged email + reset code + trusted phones gone", async () => {
    const user = await seed();
    const v = await pc.changePassword({
      userId: user.id,
      expectedTokenVersion: user.tokenVersion,
      newPasswordHash: "pv2$new",
    });
    expect(v).toBe(user.tokenVersion + 1);
    const [u] = await tx.select().from(users).where(eq(users.id, user.id));
    expect(u.password).toBe("pv2$new");
    expect(u.pendingEmail).toBeNull();
    expect(u.resetCodeHash).toBeNull();
    expect(u.emailVerified).toBe(user.emailVerified); // untouched (spec §4.2)
    const phones = await tx
      .select()
      .from(mfaTrustedDevices)
      .where(eq(mfaTrustedDevices.userId, user.id));
    expect(phones).toHaveLength(0);
  });

  it("changePassword refuses when the token version moved — nothing written", async () => {
    const user = await seed();
    expect(
      await pc.changePassword({
        userId: user.id,
        expectedTokenVersion: user.tokenVersion - 1,
        newPasswordHash: "pv2$new",
      }),
    ).toBeUndefined();
    const [u] = await tx.select().from(users).where(eq(users.id, user.id));
    expect(u.password).toBe(user.password);
    expect(u.pendingEmail).toBe("staged@example.com");
    const phones = await tx
      .select()
      .from(mfaTrustedDevices)
      .where(eq(mfaTrustedDevices.userId, user.id));
    expect(phones).toHaveLength(1);
  });

  it("changePassword consumes the code; the same code a second time is refused and rolls back", async () => {
    const user = await createTestUser(tx);
    await pc.issuePasswordChangeCode(user.id, "hash-1");
    const v1 = await pc.changePassword({
      userId: user.id,
      expectedTokenVersion: user.tokenVersion,
      newPasswordHash: "pv2$a",
      consumeCodeHash: "hash-1",
    });
    expect(v1).toBe(user.tokenVersion + 1);
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBeUndefined();
    // A second request racing with the same code, under the NEW version:
    expect(
      await pc.changePassword({
        userId: user.id,
        expectedTokenVersion: v1!,
        newPasswordHash: "pv2$b",
        consumeCodeHash: "hash-1",
      }),
    ).toBeUndefined();
    const [u] = await tx.select().from(users).where(eq(users.id, user.id));
    expect(u.password).toBe("pv2$a"); // rolled back, not overwritten
    expect(u.tokenVersion).toBe(v1);
  });

  it("the issue window survives a change (the cap persists)", async () => {
    const user = await createTestUser(tx);
    for (let i = 0; i < 5; i++)
      await pc.issuePasswordChangeCode(user.id, `c${i}`);
    await pc.changePassword({
      userId: user.id,
      expectedTokenVersion: user.tokenVersion,
      newPasswordHash: "pv2$a",
      consumeCodeHash: "c4",
    });
    expect(await pc.issuePasswordChangeCode(user.id, "c5")).toBe(false);
  });
});
