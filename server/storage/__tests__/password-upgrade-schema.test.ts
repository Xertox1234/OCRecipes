import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { users, passwordUpgradePasses } from "@shared/schema";
import { eq } from "drizzle-orm";

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

const inAMinute = () => new Date(Date.now() + 60_000);

describe("password upgrade pass schema (migration 0020)", () => {
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

  it("stores a pass with attempts 0 and no consumed_at by default", async () => {
    await tx.insert(passwordUpgradePasses).values({
      idHash: "h1",
      userId: testUser.id,
      tokenVersion: 0,
      twoStepAllowed: true,
      expiresAt: inAMinute(),
    });
    const [row] = await tx
      .select()
      .from(passwordUpgradePasses)
      .where(eq(passwordUpgradePasses.idHash, "h1"));
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("is deleted with its user", async () => {
    await tx.insert(passwordUpgradePasses).values({
      idHash: "h2",
      userId: testUser.id,
      tokenVersion: 0,
      twoStepAllowed: false,
      expiresAt: inAMinute(),
    });
    await tx.delete(users).where(eq(users.id, testUser.id));
    const rows = await tx
      .select()
      .from(passwordUpgradePasses)
      .where(eq(passwordUpgradePasses.idHash, "h2"));
    expect(rows).toHaveLength(0);
  });
});
