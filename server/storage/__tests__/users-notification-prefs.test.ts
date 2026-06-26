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
  createTestUserProfile,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { backfillNotificationPrefs } from "../notification-prefs-backfill";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

let tx: NodePgDatabase<typeof schema>;

describe("notificationPrefs backfill", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("copies reminderMutes verbatim into categories and defaults the new fields", async () => {
    const { userProfiles } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    // reminderMutes lives on user_profiles — create a user + profile with a mute
    // under TODAY's key.
    const user = await createTestUser(tx);
    await createTestUserProfile(tx, user.id, {
      reminderMutes: { "meal-log": true },
    });

    await backfillNotificationPrefs();

    const [row] = await tx
      .select({ prefs: userProfiles.notificationPrefs })
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.id));

    expect(row.prefs.categories).toEqual({ "meal-log": true }); // verbatim, no inversion
    expect(row.prefs.ambientPush).toBe(false);
    expect(row.prefs.transactionalEnabled).toBe(true);
    expect(row.prefs.quietHours).toEqual({ start: "21:00", end: "08:00" });
  });
});
