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

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
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

  // --------------------------------------------------------------------------
  // upsertPushToken
  // --------------------------------------------------------------------------
  describe("upsertPushToken", () => {
    it("inserts a new token and returns it", async () => {
      const token = await upsertPushToken(
        testUser.id,
        "ExpoToken[abc123]",
        "ios",
      );

      expect(token.id).toBeDefined();
      expect(token.userId).toBe(testUser.id);
      expect(token.token).toBe("ExpoToken[abc123]");
      expect(token.platform).toBe("ios");
    });

    it("replaces an existing token for the same user+platform (rotation)", async () => {
      await upsertPushToken(testUser.id, "ExpoToken[old]", "ios");
      await upsertPushToken(testUser.id, "ExpoToken[new]", "ios");

      const tokens = await getPushTokensForUser(testUser.id);
      // Should only have one ios token (the new one)
      const iosTokens = tokens.filter((t) => t.platform === "ios");
      expect(iosTokens).toHaveLength(1);
      expect(iosTokens[0].token).toBe("ExpoToken[new]");
    });

    it("maintains separate tokens for ios and android", async () => {
      await upsertPushToken(testUser.id, "ExpoToken[ios]", "ios");
      await upsertPushToken(testUser.id, "ExpoToken[android]", "android");

      const tokens = await getPushTokensForUser(testUser.id);
      expect(tokens).toHaveLength(2);
      const platforms = tokens.map((t) => t.platform).sort();
      expect(platforms).toEqual(["android", "ios"]);
    });
  });

  // --------------------------------------------------------------------------
  // getPushTokensForUser
  // --------------------------------------------------------------------------
  describe("getPushTokensForUser", () => {
    it("returns empty array when user has no tokens", async () => {
      const result = await getPushTokensForUser(testUser.id);
      expect(result).toEqual([]);
    });

    it("returns all tokens for the user", async () => {
      await upsertPushToken(testUser.id, "ExpoToken[ios]", "ios");
      await upsertPushToken(testUser.id, "ExpoToken[android]", "android");

      const result = await getPushTokensForUser(testUser.id);
      expect(result).toHaveLength(2);
    });

    it("does not return tokens for other users", async () => {
      const otherUser = await createTestUser(tx);
      await upsertPushToken(otherUser.id, "ExpoToken[other]", "ios");

      const result = await getPushTokensForUser(testUser.id);
      expect(result).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // getPushTokensForUsers
  // --------------------------------------------------------------------------
  describe("getPushTokensForUsers", () => {
    it("returns empty array for empty userIds list", async () => {
      const result = await getPushTokensForUsers([]);
      expect(result).toEqual([]);
    });

    it("returns tokens for all provided user IDs", async () => {
      const user2 = await createTestUser(tx);
      await upsertPushToken(testUser.id, "ExpoToken[u1]", "ios");
      await upsertPushToken(user2.id, "ExpoToken[u2]", "android");

      const result = await getPushTokensForUsers([testUser.id, user2.id]);
      expect(result).toHaveLength(2);
    });

    it("returns only tokens for users in the list", async () => {
      const user2 = await createTestUser(tx);
      const user3 = await createTestUser(tx);
      await upsertPushToken(testUser.id, "ExpoToken[u1]", "ios");
      await upsertPushToken(user3.id, "ExpoToken[u3]", "ios");

      const result = await getPushTokensForUsers([testUser.id, user2.id]);
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe(testUser.id);
    });
  });

  // --------------------------------------------------------------------------
  // deletePushToken
  // --------------------------------------------------------------------------
  describe("deletePushToken", () => {
    it("removes a specific token for the user", async () => {
      await upsertPushToken(testUser.id, "ExpoToken[del]", "ios");
      await deletePushToken(testUser.id, "ExpoToken[del]");

      const tokens = await getPushTokensForUser(testUser.id);
      expect(tokens).toHaveLength(0);
    });

    it("does not remove tokens for other users with the same token string", async () => {
      const otherUser = await createTestUser(tx);
      await upsertPushToken(otherUser.id, "ExpoToken[shared]", "ios");
      // testUser has no token, attempt to delete another user's token
      await deletePushToken(testUser.id, "ExpoToken[shared]");

      const otherTokens = await getPushTokensForUser(otherUser.id);
      expect(otherTokens).toHaveLength(1);
    });

    it("does not throw when token does not exist", async () => {
      await expect(
        deletePushToken(testUser.id, "ExpoToken[nonexistent]"),
      ).resolves.not.toThrow();
    });
  });
});
