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
  upsertPushToken,
  getPushTokensForUser,
  getPushTokensForUsers,
  deletePushToken,
} = await import("../push-tokens");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("push-tokens storage", () => {
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

  describe("upsertPushToken", () => {
    it("inserts a new token on first call", async () => {
      const row = await upsertPushToken(testUser.id, "token-A", "ios");
      expect(row.userId).toBe(testUser.id);
      expect(row.token).toBe("token-A");
      expect(row.platform).toBe("ios");
    });

    it("replaces the existing token on conflict (user+platform unique)", async () => {
      const first = await upsertPushToken(testUser.id, "token-A", "ios");
      const second = await upsertPushToken(testUser.id, "token-B", "ios");
      // Same row id, updated token.
      expect(second.id).toBe(first.id);
      expect(second.token).toBe("token-B");

      const all = await getPushTokensForUser(testUser.id);
      expect(all).toHaveLength(1);
      expect(all[0].token).toBe("token-B");
    });

    it("allows separate tokens for different platforms", async () => {
      await upsertPushToken(testUser.id, "token-ios", "ios");
      await upsertPushToken(testUser.id, "token-android", "android");
      const all = await getPushTokensForUser(testUser.id);
      expect(all).toHaveLength(2);
    });
  });

  describe("getPushTokensForUser", () => {
    it("returns empty array when user has no tokens", async () => {
      const rows = await getPushTokensForUser(testUser.id);
      expect(rows).toEqual([]);
    });
  });

  describe("getPushTokensForUsers", () => {
    it("returns empty array for empty input without hitting the DB", async () => {
      const rows = await getPushTokensForUsers([]);
      expect(rows).toEqual([]);
    });

    it("returns tokens for the given user IDs only", async () => {
      const otherUser = await createTestUser(tx);
      await upsertPushToken(testUser.id, "token-1", "ios");
      await upsertPushToken(otherUser.id, "token-2", "ios");

      const rows = await getPushTokensForUsers([testUser.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(testUser.id);
    });
  });

  describe("deletePushToken", () => {
    it("removes the matching (userId, token) row", async () => {
      await upsertPushToken(testUser.id, "token-A", "ios");
      await deletePushToken(testUser.id, "token-A");
      const rows = await getPushTokensForUser(testUser.id);
      expect(rows).toHaveLength(0);
    });

    it("is a no-op when no matching row exists", async () => {
      await expect(
        deletePushToken(testUser.id, "nonexistent"),
      ).resolves.toBeUndefined();
    });
  });
});
