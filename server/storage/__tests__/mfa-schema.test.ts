import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
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

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

const inAMinute = () => new Date(Date.now() + 60_000);

/** The pg error code, unwrapping drizzle's DrizzleQueryError `.cause`. */
async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  const err = await p.then(
    () => null,
    (e: unknown) => e as { code?: string; cause?: { code?: string } },
  );
  return err?.code ?? err?.cause?.code;
}

describe("MFA schema (migration 0018)", () => {
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

  it("users.mfa_enabled_at defaults to NULL", async () => {
    const [row] = await tx
      .select({ at: users.mfaEnabledAt })
      .from(users)
      .where(eq(users.id, testUser.id));
    expect(row.at).toBeNull();
  });

  it("deleting the user cascades to all four MFA tables", async () => {
    await tx.insert(userMfa).values({ userId: testUser.id });
    await tx.insert(mfaRecoveryCodes).values([
      { userId: testUser.id, codeHash: "a" },
      { userId: testUser.id, codeHash: "b" },
    ]);
    await tx.insert(mfaChallenges).values({
      tokenHash: "t1",
      userId: testUser.id,
      tokenVersion: 0,
      purpose: "login",
      expiresAt: inAMinute(),
    });
    await tx.insert(mfaTrustedDevices).values({
      userId: testUser.id,
      keyHash: "k1",
      expiresAt: inAMinute(),
    });

    await tx.delete(users).where(eq(users.id, testUser.id));

    const counts = await tx.execute(sql`
      SELECT (SELECT count(*) FROM user_mfa WHERE user_id = ${testUser.id})
           + (SELECT count(*) FROM mfa_recovery_codes WHERE user_id = ${testUser.id})
           + (SELECT count(*) FROM mfa_challenges WHERE user_id = ${testUser.id})
           + (SELECT count(*) FROM mfa_trusted_devices WHERE user_id = ${testUser.id})
           AS n`);
    expect(Number(counts.rows[0].n)).toBe(0);
  });

  it("a recovery code hash is unique per user (23505)", async () => {
    await tx
      .insert(mfaRecoveryCodes)
      .values({ userId: testUser.id, codeHash: "same" });
    expect(
      await pgCode(
        tx
          .insert(mfaRecoveryCodes)
          .values({ userId: testUser.id, codeHash: "same" }),
      ),
    ).toBe("23505");
  });

  it("a link challenge without a ticket hash is refused (23514)", async () => {
    expect(
      await pgCode(
        tx.insert(mfaChallenges).values({
          tokenHash: "t2",
          userId: testUser.id,
          tokenVersion: 0,
          purpose: "link",
          expiresAt: inAMinute(),
        }),
      ),
    ).toBe("23514");
  });

  it("a login challenge carrying a ticket hash is refused (23514)", async () => {
    expect(
      await pgCode(
        tx.insert(mfaChallenges).values({
          tokenHash: "t3",
          userId: testUser.id,
          tokenVersion: 0,
          purpose: "login",
          linkTicketHash: "x",
          expiresAt: inAMinute(),
        }),
      ),
    ).toBe("23514");
  });

  it("an unknown challenge purpose is refused (23514)", async () => {
    expect(
      await pgCode(
        tx.insert(mfaChallenges).values({
          tokenHash: "t4",
          userId: testUser.id,
          tokenVersion: 0,
          purpose: "other",
          expiresAt: inAMinute(),
        }),
      ),
    ).toBe("23514");
  });

  it("two trusted devices cannot share a key hash (23505)", async () => {
    await tx.insert(mfaTrustedDevices).values({
      userId: testUser.id,
      keyHash: "dup",
      expiresAt: inAMinute(),
    });
    expect(
      await pgCode(
        tx.insert(mfaTrustedDevices).values({
          userId: testUser.id,
          keyHash: "dup",
          expiresAt: inAMinute(),
        }),
      ),
    ).toBe("23505");
  });
});
