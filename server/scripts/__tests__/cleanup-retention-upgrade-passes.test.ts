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
import { passwordUpgradePasses } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { purgeDeadUpgradePasses } = await import("../cleanup-retention");

const HOUR_MS = 60 * 60 * 1000;
let tx: NodePgDatabase<typeof schema>;

describe("purgeDeadUpgradePasses (real DB)", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("drops passes dead for more than a day; keeps live and recently dead ones", async () => {
    const user = await createTestUser(tx);
    const now = new Date();
    const at = (hoursAgo: number) =>
      new Date(now.getTime() - hoursAgo * HOUR_MS);
    const row = (
      idHash: string,
      expiresAt: Date,
      consumedAt: Date | null = null,
    ) => ({
      idHash,
      userId: user.id,
      tokenVersion: 0,
      twoStepAllowed: true,
      expiresAt,
      consumedAt,
    });
    await tx
      .insert(passwordUpgradePasses)
      .values([
        row("expired-2-days", at(48)),
        row("consumed-2-days", at(-1), at(48)),
        row("expired-1-hour", at(1)),
        row("consumed-1-hour", at(-1), at(1)),
        row("live", at(-0.5)),
      ]);

    const result = await purgeDeadUpgradePasses(tx, now);

    expect(result).toEqual({
      domain: "password_upgrade_passes",
      rowsDeleted: 2,
      retentionDays: 1,
    });
    const left = (
      await tx
        .select({ id: passwordUpgradePasses.idHash })
        .from(passwordUpgradePasses)
    )
      .map((r) => r.id)
      .sort();
    expect(left).toEqual(["consumed-1-hour", "expired-1-hour", "live"]);
  });
});
