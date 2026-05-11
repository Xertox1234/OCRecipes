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
  chatConversations,
  chatMessages,
  communityRecipes,
} from "@shared/schema";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const { saveRecipeFromChat } = await import("../recipe-from-chat");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** Minimal valid recipe chat metadata for a message. */
const validRecipeChatMetadata = {
  metadataVersion: 1,
  recipe: {
    title: "Grilled Chicken Salad",
    description: "A healthy salad",
    difficulty: "easy",
    timeEstimate: "20 min",
    servings: 2,
    ingredients: [
      { name: "Chicken", quantity: "200", unit: "g" },
      { name: "Lettuce", quantity: "1", unit: "head" },
    ],
    instructions: ["Grill chicken", "Toss with lettuce"],
    dietTags: ["gluten-free"],
  },
  allergenWarning: null,
  imageUrl: null,
};

/** Create a chat conversation owned by userId. */
async function createTestConversation(
  userId: string,
  type = "recipe",
): Promise<schema.ChatConversation> {
  const [conv] = await tx
    .insert(chatConversations)
    .values({ userId, title: "Test Conversation", type })
    .returning();
  return conv;
}

/** Create a chat message in the given conversation with optional metadata. */
async function createTestMessage(
  conversationId: number,
  metadata: unknown = null,
): Promise<schema.ChatMessage> {
  const [msg] = await tx
    .insert(chatMessages)
    .values({
      conversationId,
      role: "assistant",
      content: "Here is your recipe",
      metadata: metadata as Record<string, unknown> | null,
    })
    .returning();
  return msg;
}

describe("recipe-from-chat storage", () => {
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
  // saveRecipeFromChat
  // --------------------------------------------------------------------------
  describe("saveRecipeFromChat", () => {
    it("returns null when conversation does not belong to the user", async () => {
      const otherUser = await createTestUser(tx);
      const conv = await createTestConversation(otherUser.id);
      const msg = await createTestMessage(conv.id, validRecipeChatMetadata);

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).toBeNull();
    });

    it("returns null when message has no metadata", async () => {
      const conv = await createTestConversation(testUser.id);
      const msg = await createTestMessage(conv.id, null);

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).toBeNull();
    });

    it("returns null when message metadata fails Zod validation", async () => {
      const conv = await createTestConversation(testUser.id);
      const msg = await createTestMessage(conv.id, { invalid: "data" });

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).toBeNull();
    });

    it("creates a community recipe from a valid chat message", async () => {
      const conv = await createTestConversation(testUser.id);
      const msg = await createTestMessage(conv.id, validRecipeChatMetadata);

      const result = await saveRecipeFromChat(
        msg.id,
        conv.id,
        testUser.id,
        undefined,
        ["salad", "lunch"],
      );

      expect(result).not.toBeNull();
      expect(result!.title).toBe("Grilled Chicken Salad");
      expect(result!.authorId).toBe(testUser.id);
      expect(result!.isPublic).toBe(false);
      expect(result!.sourceMessageId).toBe(msg.id);
      expect(result!.mealTypes).toEqual(["salad", "lunch"]);
    });

    it("updates message metadata with the savedRecipeId back-reference", async () => {
      const conv = await createTestConversation(testUser.id);
      const msg = await createTestMessage(conv.id, validRecipeChatMetadata);

      const recipe = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(recipe).not.toBeNull();

      const { eq } = await import("drizzle-orm");
      const [updatedMsg] = await tx
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, msg.id));

      expect(updatedMsg.metadata).toBeDefined();
      const meta = updatedMsg.metadata as Record<string, unknown>;
      expect(meta.savedRecipeId).toBe(recipe!.id);
    });

    it("is idempotent — second call returns the existing recipe", async () => {
      const conv = await createTestConversation(testUser.id);
      const msg = await createTestMessage(conv.id, validRecipeChatMetadata);

      const first = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(first).not.toBeNull();

      const second = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(second).not.toBeNull();
      expect(second!.id).toBe(first!.id);
    });

    it("records lineage when remixedFromId and remixedFromTitle are provided", async () => {
      // Create a source recipe to remix from
      const [sourceRecipe] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          title: "Original Pasta",
          normalizedProductName: "test-original-pasta",
          instructions: ["Boil pasta"],
        })
        .returning();

      const conv = await createTestConversation(testUser.id, "remix");
      const remixMetadata = {
        ...validRecipeChatMetadata,
        recipe: {
          ...validRecipeChatMetadata.recipe,
          title: "Remixed Pasta Salad",
        },
      };
      const msg = await createTestMessage(conv.id, remixMetadata);

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id, {
        remixedFromId: sourceRecipe.id,
        remixedFromTitle: "Original Pasta",
      });

      expect(result).not.toBeNull();
      expect(result!.title).toBe("Remixed Pasta Salad");
      expect(result!.remixedFromId).toBe(sourceRecipe.id);
      expect(result!.remixedFromTitle).toBe("Original Pasta");
    });

    it("returns existing recipe via legacy savedRecipeId fallback in metadata", async () => {
      const conv = await createTestConversation(testUser.id);
      // Create an existing recipe to reference
      const [existingRecipe] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          title: "Pre-existing Recipe",
          normalizedProductName: "test-pre-existing-recipe",
          instructions: ["Cook it"],
        })
        .returning();

      // Message metadata with invalid Zod schema but valid savedRecipeId
      const legacyMetadata = { savedRecipeId: existingRecipe.id };
      const msg = await createTestMessage(conv.id, legacyMetadata);

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(existingRecipe.id);
    });
  });
});
