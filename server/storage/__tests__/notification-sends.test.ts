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

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  recordNotificationSend,
  getLastNotificationSend,
  claimNotificationSend,
} = await import("../notification-sends");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("notification-sends storage", () => {
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

  it("records a send and returns it as the last send", async () => {
    const when = new Date("2026-06-25T10:00:00Z");
    await recordNotificationSend({
      userId: testUser.id,
      category: "winback",
      sentAt: when,
    });
    const last = await getLastNotificationSend(testUser.id, "winback");
    expect(last?.toISOString()).toBe(when.toISOString());
  });

  it("is idempotent for the same user+category+UTC-day (onConflictDoNothing)", async () => {
    const a = new Date("2026-06-25T08:00:00Z");
    const b = new Date("2026-06-25T20:00:00Z"); // same UTC day
    await recordNotificationSend({
      userId: testUser.id,
      category: "scan-nudge",
      sentAt: a,
    });
    await recordNotificationSend({
      userId: testUser.id,
      category: "scan-nudge",
      sentAt: b,
    });
    const rows = await tx
      .select()
      .from((await import("@shared/schema")).notificationSends);
    const scanRows = rows.filter((r) => r.category === "scan-nudge");
    expect(scanRows).toHaveLength(1); // second insert no-opped
  });

  it("claims the day's slot once: the second claim the same UTC day loses", async () => {
    const first = await claimNotificationSend({
      userId: testUser.id,
      category: "pantry-expiring",
      sentAt: new Date("2026-06-25T08:00:00Z"),
    });
    const second = await claimNotificationSend({
      userId: testUser.id,
      category: "pantry-expiring",
      sentAt: new Date("2026-06-25T20:00:00Z"),
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("gives a fresh slot the next UTC day, and to another category", async () => {
    const day1 = new Date("2026-06-25T08:00:00Z");
    await claimNotificationSend({
      userId: testUser.id,
      category: "pantry-expiring",
      sentAt: day1,
    });
    expect(
      await claimNotificationSend({
        userId: testUser.id,
        category: "pantry-expiring",
        sentAt: new Date("2026-06-26T08:00:00Z"),
      }),
    ).toBe(true);
    expect(
      await claimNotificationSend({
        userId: testUser.id,
        category: "other",
        sentAt: day1,
      }),
    ).toBe(true);
  });

  it("returns null when there is no send for the pair", async () => {
    const last = await getLastNotificationSend(testUser.id, "winback");
    expect(last).toBeNull();
  });
});
