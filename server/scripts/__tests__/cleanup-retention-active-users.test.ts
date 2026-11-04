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
import { chatConversations, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));
// Storage-layer purge with photo deletes; not what these tests measure.
vi.mock("../purge-inspired-suggestions", () => ({
  purgeExpiredInspiredSuggestions: vi.fn().mockResolvedValue({}),
}));

const { getActiveUserIds, runRetentionCleanup } = await import(
  "../cleanup-retention"
);

const DAY_MS = 24 * 60 * 60 * 1000;
let tx: NodePgDatabase<typeof schema>;

async function userLastSeen(daysAgo: number, now: Date) {
  const user = await createTestUser(tx);
  await tx
    .update(users)
    .set({ lastActiveAt: new Date(now.getTime() - daysAgo * DAY_MS) })
    .where(eq(users.id, user.id));
  return user;
}

describe("getActiveUserIds (real DB) — any use of the app counts", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("treats a user who used the app 10 days ago as active, with no other signal", async () => {
    const now = new Date();
    const recent = await userLastSeen(10, now);

    const active = await getActiveUserIds(tx, now);

    expect(active.has(recent.id)).toBe(true);
  });

  it("does not treat a user last seen 40 days ago as active", async () => {
    const now = new Date();
    const stale = await userLastSeen(40, now);
    const never = await createTestUser(tx);

    const active = await getActiveUserIds(tx, now);

    expect(active.has(stale.id)).toBe(false);
    expect(active.has(never.id)).toBe(false);
  });
});

describe("runRetentionCleanup (real DB) — active users are exempt", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  it("purges a stale user's old chat but keeps an active user's", async () => {
    // The exclusion list used to render as ($1, $2, ...)::text[], which
    // Postgres rejects, so every purge failed once any user was active.
    const now = new Date();
    const old = new Date(now.getTime() - 400 * DAY_MS);
    const active = await userLastSeen(1, now);
    const stale = await userLastSeen(400, now);
    const [kept, purged] = await tx
      .insert(chatConversations)
      .values([
        { userId: active.id, title: "kept", updatedAt: old, createdAt: old },
        { userId: stale.id, title: "purged", updatedAt: old, createdAt: old },
      ])
      .returning({ id: chatConversations.id });

    await runRetentionCleanup(tx, now);

    const left = await tx
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(inArray(chatConversations.id, [kept.id, purged.id]));
    expect(left.map((r) => r.id)).toEqual([kept.id]);
  });
});
