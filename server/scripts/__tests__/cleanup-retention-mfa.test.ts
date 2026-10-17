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
import { mfaChallenges, mfaTrustedDevices } from "@shared/schema";
import { eq, ne } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { purgeExpiredMfaRows } = await import("../cleanup-retention");

const HOUR_MS = 60 * 60 * 1000;
let tx: NodePgDatabase<typeof schema>;

// Auth audit 2026-10-10 L14: rows are otherwise pruned only per user on that
// user's next insert, so an inactive user's dead rows stay forever.
describe("purgeExpiredMfaRows (real DB)", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("drops challenges and trusted phones dead for over a day, keeps the rest", async () => {
    const a = await createTestUser(tx);
    const now = new Date();
    const at = (hoursAgo: number) =>
      new Date(now.getTime() - hoursAgo * HOUR_MS);

    const challenge = (tokenHash: string, expiresAt: Date) => ({
      tokenHash,
      userId: a.id,
      tokenVersion: 0,
      purpose: "login",
      expiresAt,
    });
    await tx
      .insert(mfaChallenges)
      .values([
        challenge("ch-2-days", at(48)),
        challenge("ch-3-days", at(72)),
        challenge("ch-1-hour", at(1)),
        challenge("ch-live", at(-0.1)),
      ]);
    const device = (keyHash: string, expiresAt: Date) => ({
      userId: a.id,
      keyHash,
      expiresAt,
    });
    await tx
      .insert(mfaTrustedDevices)
      .values([
        device("dev-2-days", at(48)),
        device("dev-1-hour", at(1)),
        device("dev-live", at(-24 * 20)),
      ]);
    // Rows of another user, standing in for whatever the dev database already
    // holds — the rolled-back transaction hides only this test's own writes.
    const other = await createTestUser(tx);
    await tx.insert(mfaChallenges).values([
      { ...challenge("other-ch-old", at(48)), userId: other.id },
      { ...challenge("other-ch-live", at(-0.1)), userId: other.id },
    ]);
    await tx
      .insert(mfaTrustedDevices)
      .values([{ ...device("other-dev-old", at(48)), userId: other.id }]);
    // The purge is table-wide, so its counts include any foreign row it drops:
    // measure those and add them to this user's expected deletions.
    const foreignRows = async () => ({
      challenges: (
        await tx
          .select({ id: mfaChallenges.tokenHash })
          .from(mfaChallenges)
          .where(ne(mfaChallenges.userId, a.id))
      ).length,
      devices: (
        await tx
          .select({ id: mfaTrustedDevices.keyHash })
          .from(mfaTrustedDevices)
          .where(ne(mfaTrustedDevices.userId, a.id))
      ).length,
    });
    const before = await foreignRows();
    // Batch size 1 so the loop must run more than once to drain each table.
    const results = await purgeExpiredMfaRows(tx, now, 1);
    const after = await foreignRows();

    expect(results).toEqual([
      {
        domain: "mfa_challenges",
        rowsDeleted: 2 + before.challenges - after.challenges,
        retentionDays: 1,
      },
      {
        domain: "mfa_trusted_devices",
        rowsDeleted: 1 + before.devices - after.devices,
        retentionDays: 1,
      },
    ]);
    const challengesOf = async (userId: string) =>
      (
        await tx
          .select({ id: mfaChallenges.tokenHash })
          .from(mfaChallenges)
          .where(eq(mfaChallenges.userId, userId))
      )
        .map((r) => r.id)
        .sort();
    const devicesOf = async (userId: string) =>
      (
        await tx
          .select({ id: mfaTrustedDevices.keyHash })
          .from(mfaTrustedDevices)
          .where(eq(mfaTrustedDevices.userId, userId))
      )
        .map((r) => r.id)
        .sort();
    expect(await challengesOf(a.id)).toEqual(["ch-1-hour", "ch-live"]);
    expect(await devicesOf(a.id)).toEqual(["dev-1-hour", "dev-live"]);
    // The other user's rows follow the same rule.
    expect(await challengesOf(other.id)).toEqual(["other-ch-live"]);
    expect(await devicesOf(other.id)).toEqual([]);
  });
});
