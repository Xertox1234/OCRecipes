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
  mfaTrustedDevices,
  passwordUpgradePasses,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const passes = await import("../upgrade-passes");
const mfa = await import("../mfa");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;
let otherUser: schema.User;

// All queries share the one test transaction (one connection), so the
// "second use" cases below serialise; they pin that the SQL guard admits
// exactly one winner, not true parallelism (the itest covers real requests).

const pass = (
  over: Partial<{
    idHash: string;
    tokenVersion: number;
    twoStepAllowed: boolean;
  }> = {},
) => ({
  idHash: "hash-a",
  userId: testUser.id,
  tokenVersion: testUser.tokenVersion,
  twoStepAllowed: true,
  ...over,
});

async function markConsumed(idHash: string) {
  await tx
    .update(passwordUpgradePasses)
    .set({ consumedAt: sql`now()` })
    .where(eq(passwordUpgradePasses.idHash, idHash));
}

describe("upgrade pass storage", () => {
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

  it("a fresh pass is live for 30 minutes; an expired one is not", async () => {
    await passes.createUpgradePass(pass());
    const live = await passes.getLiveUpgradePass("hash-a");
    expect(live).toMatchObject({ userId: testUser.id, attempts: 0 });
    const minutes =
      (live!.expiresAt.getTime() - live!.createdAt.getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(30);

    await tx
      .update(passwordUpgradePasses)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(passwordUpgradePasses.idHash, "hash-a"));
    expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
  });

  it("a consumed pass is not live", async () => {
    await passes.createUpgradePass(pass());
    await markConsumed("hash-a");
    expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
  });

  it("reserves at most 10 attempts, then the pass is dead", async () => {
    await passes.createUpgradePass(pass());
    for (let i = 1; i <= 10; i++) {
      expect((await passes.reserveUpgradePassAttempt("hash-a"))?.attempts).toBe(
        i,
      );
    }
    expect(await passes.reserveUpgradePassAttempt("hash-a")).toBeUndefined();
    expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
  });

  it("a consumed pass reserves no attempt", async () => {
    await passes.createUpgradePass(pass());
    await markConsumed("hash-a");
    expect(await passes.reserveUpgradePassAttempt("hash-a")).toBeUndefined();
  });

  it("a new pass deletes the same user's dead passes, not live ones or other users'", async () => {
    await passes.createUpgradePass(pass({ idHash: "old-dead" }));
    await markConsumed("old-dead");
    await passes.createUpgradePass(pass({ idHash: "old-live" }));
    await passes.createUpgradePass({
      ...pass({ idHash: "other-dead" }),
      userId: otherUser.id,
      tokenVersion: otherUser.tokenVersion,
    });
    await markConsumed("other-dead");

    await passes.createUpgradePass(pass({ idHash: "new" }));

    const ids = (
      await tx
        .select({ id: passwordUpgradePasses.idHash })
        .from(passwordUpgradePasses)
    )
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual(["new", "old-live", "other-dead"]);
  });

  it("completePasswordUpgrade: new hash, version bump, trusted phones gone, staged email dropped, pass consumed", async () => {
    await tx
      .update(users)
      .set({ pendingEmail: "new@test.invalid" })
      .where(eq(users.id, testUser.id));
    await tx.insert(mfaTrustedDevices).values({
      userId: testUser.id,
      keyHash: "k",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await passes.createUpgradePass(pass());

    const v = await passes.completePasswordUpgrade({
      idHash: "hash-a",
      userId: testUser.id,
      tokenVersion: testUser.tokenVersion,
      newPasswordHash: "pv2$new",
    });

    expect(v).toBe(testUser.tokenVersion + 1);
    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.password).toBe("pv2$new");
    expect(u.pendingEmail).toBeNull();
    expect(
      await tx
        .select()
        .from(mfaTrustedDevices)
        .where(eq(mfaTrustedDevices.userId, testUser.id)),
    ).toHaveLength(0);
    expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
  });

  it("completePasswordUpgrade works once per pass", async () => {
    await passes.createUpgradePass(pass());
    const args = {
      idHash: "hash-a",
      userId: testUser.id,
      tokenVersion: testUser.tokenVersion,
      newPasswordHash: "pv2$x",
    };
    expect(await passes.completePasswordUpgrade(args)).toBeDefined();
    expect(await passes.completePasswordUpgrade(args)).toBeUndefined();
  });

  it("completePasswordUpgrade refuses once tokenVersion moved on, and changes nothing", async () => {
    await passes.createUpgradePass(pass());
    // A reset elsewhere bumped the version AFTER the pass was minted.
    await tx
      .update(users)
      .set({ tokenVersion: testUser.tokenVersion + 1 })
      .where(eq(users.id, testUser.id));

    expect(
      await passes.completePasswordUpgrade({
        idHash: "hash-a",
        userId: testUser.id,
        tokenVersion: testUser.tokenVersion,
        newPasswordHash: "pv2$x",
      }),
    ).toBeUndefined();

    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.password).toBe(testUser.password);
    // Rolled back with the transaction: the pass itself was not spent.
    const [p] = await tx
      .select()
      .from(passwordUpgradePasses)
      .where(eq(passwordUpgradePasses.idHash, "hash-a"));
    expect(p.consumedAt).toBeNull();
  });

  it("completePasswordUpgrade refuses another user's pass", async () => {
    await passes.createUpgradePass(pass());
    expect(
      await passes.completePasswordUpgrade({
        idHash: "hash-a",
        userId: otherUser.id,
        tokenVersion: otherUser.tokenVersion,
        newPasswordHash: "pv2$x",
      }),
    ).toBeUndefined();
  });

  it("confirmTotpEnrollment with an upgradePass consumes it in the same transaction; a second confirm loses", async () => {
    await passes.createUpgradePass(pass());
    await mfa.startTotpEnrollment(testUser.id, "enc");
    const opts = {
      acceptedStep: 1,
      recoveryHashes: ["h1"],
      upgradePass: { idHash: "hash-a", tokenVersion: testUser.tokenVersion },
    };
    expect(await mfa.confirmTotpEnrollment(testUser.id, opts)).toBe(
      testUser.tokenVersion + 1,
    );
    expect(await mfa.confirmTotpEnrollment(testUser.id, opts)).toBeUndefined();
    expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
  });

  it("confirmTotpEnrollment with a consumed pass changes nothing", async () => {
    await passes.createUpgradePass(pass());
    await markConsumed("hash-a");
    await mfa.startTotpEnrollment(testUser.id, "enc");
    expect(
      await mfa.confirmTotpEnrollment(testUser.id, {
        acceptedStep: 1,
        recoveryHashes: ["h1"],
        upgradePass: { idHash: "hash-a", tokenVersion: testUser.tokenVersion },
      }),
    ).toBeUndefined();
    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.mfaEnabledAt).toBeNull();
  });

  it("confirmTotpEnrollment with a pass whose tokenVersion moved on changes nothing", async () => {
    await passes.createUpgradePass(pass());
    await mfa.startTotpEnrollment(testUser.id, "enc");
    await tx
      .update(users)
      .set({ tokenVersion: testUser.tokenVersion + 1 })
      .where(eq(users.id, testUser.id));
    expect(
      await mfa.confirmTotpEnrollment(testUser.id, {
        acceptedStep: 1,
        recoveryHashes: ["h1"],
        upgradePass: { idHash: "hash-a", tokenVersion: testUser.tokenVersion },
      }),
    ).toBeUndefined();
    const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
    expect(u.mfaEnabledAt).toBeNull();
    expect(await passes.getLiveUpgradePass("hash-a")).toBeDefined();
  });
});
