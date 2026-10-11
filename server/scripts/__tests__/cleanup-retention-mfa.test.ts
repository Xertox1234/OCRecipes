import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { mfaChallenges, mfaTrustedDevices, userMfa } from "@shared/schema";

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

  it("drops challenges and trusted phones dead for over a day, clears stale pending secrets, keeps the rest", async () => {
    const [a, b, c] = [
      await createTestUser(tx),
      await createTestUser(tx),
      await createTestUser(tx),
    ];
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
    await tx.insert(userMfa).values([
      // An abandoned setup: candidate secret dead for two days.
      {
        userId: a.id,
        totpSecretEnc: "active",
        pendingSecretEnc: "stale",
        pendingExpiresAt: at(48),
      },
      // Dead for an hour only — kept until the day has passed.
      { userId: b.id, pendingSecretEnc: "recent", pendingExpiresAt: at(1) },
      // Setup still in progress.
      { userId: c.id, pendingSecretEnc: "live", pendingExpiresAt: at(-0.1) },
    ]);

    // Batch size 1 so the loop must run more than once to drain each table.
    const results = await purgeExpiredMfaRows(tx, now, 1);

    expect(results).toEqual([
      { domain: "mfa_challenges", rowsDeleted: 2, retentionDays: 1 },
      { domain: "mfa_trusted_devices", rowsDeleted: 1, retentionDays: 1 },
      { domain: "user_mfa_pending_secrets", rowsDeleted: 1, retentionDays: 1 },
    ]);
    const challenges = (
      await tx.select({ id: mfaChallenges.tokenHash }).from(mfaChallenges)
    )
      .map((r) => r.id)
      .sort();
    expect(challenges).toEqual(["ch-1-hour", "ch-live"]);
    const devices = (
      await tx.select({ id: mfaTrustedDevices.keyHash }).from(mfaTrustedDevices)
    )
      .map((r) => r.id)
      .sort();
    expect(devices).toEqual(["dev-1-hour", "dev-live"]);

    const [aMfa] = await tx
      .select()
      .from(userMfa)
      .where(eq(userMfa.userId, a.id));
    // Only the candidate is cleared; the confirmed secret is untouched.
    expect(aMfa.pendingSecretEnc).toBeNull();
    expect(aMfa.pendingExpiresAt).toBeNull();
    expect(aMfa.totpSecretEnc).toBe("active");
    const pending = (
      await tx
        .select({ secret: userMfa.pendingSecretEnc })
        .from(userMfa)
        .where(eq(userMfa.userId, b.id))
    ).concat(
      await tx
        .select({ secret: userMfa.pendingSecretEnc })
        .from(userMfa)
        .where(eq(userMfa.userId, c.id)),
    );
    expect(pending.map((r) => r.secret)).toEqual(["recent", "live"]);
  });
});
