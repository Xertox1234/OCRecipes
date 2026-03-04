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
  getChatConversation,
  getChatConversations,
  createChatConversation,
  getChatMessages,
  createChatMessage,
  deleteChatConversation,
  updateChatConversationTitle,
  getDailyChatMessageCount,
} = await import("../chat");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("chat storage", () => {
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

  // ---- Conversations ----

  describe("createChatConversation", () => {
    it("creates a conversation", async () => {
      const conv = await createChatConversation(testUser.id, "Test Chat");
      expect(conv.id).toBeDefined();
      expect(conv.userId).toBe(testUser.id);
      expect(conv.title).toBe("Test Chat");
    });
  });

  describe("getChatConversation", () => {
    it("returns the conversation when found", async () => {
      const conv = await createChatConversation(testUser.id, "My Chat");
      const found = await getChatConversation(conv.id, testUser.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe("My Chat");
    });

    it("returns undefined for non-existent id", async () => {
      const found = await getChatConversation(999999, testUser.id);
      expect(found).toBeUndefined();
    });

    it("returns undefined for wrong user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const conv = await createChatConversation(otherUser.id, "Other Chat");

      const found = await getChatConversation(conv.id, testUser.id);
      expect(found).toBeUndefined();
    });
  });

  describe("getChatConversations", () => {
    it("returns conversations ordered by updatedAt desc", async () => {
      await createChatConversation(testUser.id, "Older");
      // Make conv2 newer by updating its timestamp via a message
      const conv2 = await createChatConversation(testUser.id, "Newer");
      await createChatMessage(conv2.id, "user", "Hello");

      const convos = await getChatConversations(testUser.id);
      expect(convos).toHaveLength(2);
      expect(convos[0].title).toBe("Newer");
    });

    it("respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        await createChatConversation(testUser.id, `Chat ${i}`);
      }
      const convos = await getChatConversations(testUser.id, 3);
      expect(convos).toHaveLength(3);
    });
  });

  describe("deleteChatConversation", () => {
    it("deletes owned conversation and returns true", async () => {
      const conv = await createChatConversation(testUser.id, "To Delete");
      const deleted = await deleteChatConversation(conv.id, testUser.id);
      expect(deleted).toBe(true);

      const found = await getChatConversation(conv.id, testUser.id);
      expect(found).toBeUndefined();
    });

    it("returns false for wrong user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const conv = await createChatConversation(otherUser.id, "Other's Chat");

      const deleted = await deleteChatConversation(conv.id, testUser.id);
      expect(deleted).toBe(false);
    });

    it("returns false for non-existent id", async () => {
      const deleted = await deleteChatConversation(999999, testUser.id);
      expect(deleted).toBe(false);
    });
  });

  describe("updateChatConversationTitle", () => {
    it("updates the title", async () => {
      const conv = await createChatConversation(testUser.id, "Original");
      const updated = await updateChatConversationTitle(
        conv.id,
        testUser.id,
        "Renamed",
      );
      expect(updated).toBeDefined();
      expect(updated!.title).toBe("Renamed");
    });

    it("returns undefined for wrong user", async () => {
      const otherUser = await createTestUser(tx);
      const conv = await createChatConversation(otherUser.id, "Other");
      const updated = await updateChatConversationTitle(
        conv.id,
        testUser.id,
        "Hacked",
      );
      expect(updated).toBeUndefined();
    });
  });

  // ---- Messages ----

  describe("createChatMessage", () => {
    it("creates a message and updates conversation updatedAt", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      const before = conv.updatedAt;

      // Small delay to ensure timestamp difference
      await new Promise((r) => setTimeout(r, 10));
      const msg = await createChatMessage(conv.id, "user", "Hello!");
      expect(msg.id).toBeDefined();
      expect(msg.conversationId).toBe(conv.id);
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Hello!");

      const updatedConv = await getChatConversation(conv.id, testUser.id);
      expect(updatedConv!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
    });

    it("stores metadata", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      const msg = await createChatMessage(conv.id, "assistant", "Reply", {
        tokens: 42,
      });
      expect(msg.metadata).toEqual({ tokens: 42 });
    });
  });

  describe("getChatMessages", () => {
    it("returns messages ordered by createdAt asc", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      await createChatMessage(conv.id, "user", "First");
      await createChatMessage(conv.id, "assistant", "Second");

      const messages = await getChatMessages(conv.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("First");
      expect(messages[1].content).toBe("Second");
    });

    it("respects limit", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      for (let i = 0; i < 5; i++) {
        await createChatMessage(conv.id, "user", `Message ${i}`);
      }
      const messages = await getChatMessages(conv.id, 3);
      expect(messages).toHaveLength(3);
    });
  });

  describe("getDailyChatMessageCount", () => {
    it("counts user messages for the given day", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      await createChatMessage(conv.id, "user", "Hello");
      await createChatMessage(conv.id, "assistant", "Hi"); // should not count
      await createChatMessage(conv.id, "user", "How are you?");

      const count = await getDailyChatMessageCount(testUser.id, new Date());
      expect(count).toBe(2);
    });

    it("returns 0 when no messages exist", async () => {
      const count = await getDailyChatMessageCount(testUser.id, new Date());
      expect(count).toBe(0);
    });
  });
});
