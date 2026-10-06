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
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

let tx: NodePgDatabase<typeof schema>;

describe("MFA schema", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("users.mfa_enabled_at defaults to NULL", async () => {
    const u = await createTestUser(tx);
    expect(u.mfaEnabledAt).toBeNull();
  });

  it("deleting a user cascades to all three MFA tables", async () => {
    const u = await createTestUser(tx);
    await tx.insert(userMfa).values({ userId: u.id, totpSecretEnc: "enc" });
    await tx.insert(mfaRecoveryCodes).values([
      { userId: u.id, codeHash: "h1" },
      { userId: u.id, codeHash: "h2" },
    ]);
    await tx.insert(mfaChallenges).values({
      tokenHash: "t1",
      userId: u.id,
      tokenVersion: 0,
      purpose: "login",
      expiresAt: sql`now() + interval '5 minutes'`,
    });

    await tx.delete(users).where(eq(users.id, u.id));

    expect(
      await tx.select().from(userMfa).where(eq(userMfa.userId, u.id)),
    ).toHaveLength(0);
    expect(
      await tx
        .select()
        .from(mfaRecoveryCodes)
        .where(eq(mfaRecoveryCodes.userId, u.id)),
    ).toHaveLength(0);
    expect(
      await tx
        .select()
        .from(mfaChallenges)
        .where(eq(mfaChallenges.userId, u.id)),
    ).toHaveLength(0);
  });

  it("a recovery-code hash is unique per user", async () => {
    const u = await createTestUser(tx);
    await tx.insert(mfaRecoveryCodes).values({ userId: u.id, codeHash: "dup" });
    await expect(
      tx.insert(mfaRecoveryCodes).values({ userId: u.id, codeHash: "dup" }),
    ).rejects.toThrow();
  });

  it("a challenge purpose outside login/link is refused", async () => {
    const u = await createTestUser(tx);
    await expect(
      tx.insert(mfaChallenges).values({
        tokenHash: "t2",
        userId: u.id,
        tokenVersion: 0,
        purpose: "other",
        expiresAt: sql`now() + interval '5 minutes'`,
      }),
    ).rejects.toThrow();
  });
});
