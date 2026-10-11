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
import { passwordChangeCodes } from "@shared/schema";

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
});
