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
import { communityRecipes } from "@shared/schema";
import { eq } from "drizzle-orm";

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
  createChatMessageWithLimitCheck,
} = await import("../chat");

const { saveRecipeFromChat } = await import("../recipe-from-chat");

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
      await createChatMessage(conv2.id, testUser.id, "user", "Hello");

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

      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "user",
        "Hello!",
      );
      expect(msg.id).toBeDefined();
      expect(msg.conversationId).toBe(conv.id);
      expect(msg.role).toBe("user");
      expect(msg.content).toBe("Hello!");

      const updatedConv = await getChatConversation(conv.id, testUser.id);
      expect(updatedConv!.updatedAt.getTime()).toBeGreaterThan(
        before.getTime(),
      );
    });

    it("stores metadata", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "assistant",
        "Reply",
        { tokens: 42 },
      );
      expect(msg.metadata).toEqual({ tokens: 42 });
    });

    it("rejects messages for conversations owned by another user", async () => {
      const otherUser = await createTestUser(tx);
      const conv = await createChatConversation(otherUser.id, "Other Chat");

      await expect(
        createChatMessage(conv.id, testUser.id, "assistant", "Nope"),
      ).rejects.toThrow("Conversation not found");
    });

    it("rejects invalid roles before insert", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");

      await expect(
        createChatMessage(
          conv.id,
          testUser.id,
          "developer" as "assistant",
          "Nope",
        ),
      ).rejects.toThrow("Invalid chat message role");
    });
  });

  describe("getChatMessages", () => {
    it("returns messages ordered by createdAt asc", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      await createChatMessage(conv.id, testUser.id, "user", "First");
      await createChatMessage(conv.id, testUser.id, "assistant", "Second");

      const messages = await getChatMessages(conv.id, 100, testUser.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("First");
      expect(messages[1].content).toBe("Second");
    });

    it("respects limit", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      for (let i = 0; i < 5; i++) {
        await createChatMessage(conv.id, testUser.id, "user", `Message ${i}`);
      }
      const messages = await getChatMessages(conv.id, 3, testUser.id);
      expect(messages).toHaveLength(3);
    });
  });

  describe("getDailyChatMessageCount", () => {
    it("counts user messages for the given day", async () => {
      const conv = await createChatConversation(testUser.id, "Chat");
      await createChatMessage(conv.id, testUser.id, "user", "Hello");
      await createChatMessage(conv.id, testUser.id, "assistant", "Hi"); // should not count
      await createChatMessage(conv.id, testUser.id, "user", "How are you?");

      const count = await getDailyChatMessageCount(testUser.id, new Date());
      expect(count).toBe(2);
    });

    it("returns 0 when no messages exist", async () => {
      const count = await getDailyChatMessageCount(testUser.id, new Date());
      expect(count).toBe(0);
    });
  });

  // ---- Remix quota (createChatMessageWithLimitCheck) ----

  describe("createChatMessageWithLimitCheck — remix", () => {
    it("first message in remix conversation counts against quota", async () => {
      const conv = await createChatConversation(
        testUser.id,
        "Remix Chat",
        "remix",
        { sourceRecipeId: 1, sourceRecipeTitle: "Original" },
      );

      // First message should succeed (quota is 5)
      const msg = await createChatMessageWithLimitCheck(
        conv.id,
        testUser.id,
        "Make it spicy",
        5,
        "remix",
      );
      expect(msg).not.toBeNull();
      expect(msg!.content).toBe("Make it spicy");
    });

    it("returns null when the conversation belongs to a different user (H11 — 2026-04-18)", async () => {
      const otherUser = await createTestUser(tx);
      const otherConv = await createChatConversation(
        otherUser.id,
        "Their Chat",
        "coach",
      );

      // testUser attempts to post into otherUser's conversation — storage
      // must refuse even without any route-level ownership check.
      const msg = await createChatMessageWithLimitCheck(
        otherConv.id,
        testUser.id,
        "sneaky message",
        50,
        "coach",
      );
      expect(msg).toBeNull();
    });

    it("second message in same remix conversation does NOT count against quota", async () => {
      const conv = await createChatConversation(
        testUser.id,
        "Remix Chat",
        "remix",
        { sourceRecipeId: 1, sourceRecipeTitle: "Original" },
      );

      // First message
      await createChatMessageWithLimitCheck(
        conv.id,
        testUser.id,
        "Make it spicy",
        1, // daily limit = 1
        "remix",
      );

      // Second message in same conversation — should succeed despite limit of 1
      const msg2 = await createChatMessageWithLimitCheck(
        conv.id,
        testUser.id,
        "Actually, make it mild",
        1,
        "remix",
      );
      expect(msg2).not.toBeNull();
      expect(msg2!.content).toBe("Actually, make it mild");
    });

    it("recipe type correctly counts remix conversations as 1 each", async () => {
      // Create a remix conversation and add a user message
      const remixConv = await createChatConversation(
        testUser.id,
        "Remix Chat",
        "remix",
        { sourceRecipeId: 1, sourceRecipeTitle: "Original" },
      );
      await createChatMessageWithLimitCheck(
        remixConv.id,
        testUser.id,
        "Make it spicy",
        5,
        "remix",
      );

      // Now try to create a recipe-type message — should count the remix conv
      const recipeConv = await createChatConversation(
        testUser.id,
        "Recipe Chat",
        "recipe",
      );
      // With limit of 1, the remix conv already consumed 1 generation
      const msg = await createChatMessageWithLimitCheck(
        recipeConv.id,
        testUser.id,
        "Make me a salad",
        1,
        "recipe",
      );
      expect(msg).toBeNull(); // Should be blocked — 1 remix conv counts as 1 generation
    });
  });

  // ---- saveRecipeFromChat with lineage ----

  describe("saveRecipeFromChat — lineage", () => {
    it("creates recipe with remixedFromId and remixedFromTitle when lineage provided", async () => {
      // Create a source recipe so the FK constraint is satisfied.
      // `test-` prefix: ensures global-teardown / cleanup-seed-recipes
      // catches any row that leaks past transaction rollback. See
      // `server/scripts/cleanup-seed-recipes-utils.ts`.
      const [sourceRecipe] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          normalizedProductName: "test-original pasta",
          title: "Original Pasta",
          instructions: ["Boil pasta"],
        })
        .returning();

      const conv = await createChatConversation(
        testUser.id,
        "Remix Chat",
        "remix",
        {
          sourceRecipeId: sourceRecipe.id,
          sourceRecipeTitle: "Original Pasta",
        },
      );

      // Insert an assistant message with valid recipe metadata
      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "assistant",
        "Here it is!",
        {
          metadataVersion: 1,
          recipe: {
            title: "Spicy Pasta",
            description: "A spicy version",
            difficulty: "Easy",
            timeEstimate: "30 min",
            servings: 4,
            ingredients: [{ name: "Pasta", quantity: "200", unit: "g" }],
            instructions: ["Cook pasta", "Add spice"],
            dietTags: ["spicy"],
          },
          allergenWarning: null,
          imageUrl: null,
        },
      );

      const recipe = await saveRecipeFromChat(msg.id, conv.id, testUser.id, {
        remixedFromId: sourceRecipe.id,
        remixedFromTitle: "Original Pasta",
      });

      expect(recipe).not.toBeNull();
      expect(recipe!.title).toBe("Spicy Pasta");
      expect(recipe!.remixedFromId).toBe(sourceRecipe.id);
      expect(recipe!.remixedFromTitle).toBe("Original Pasta");
      expect(recipe!.authorId).toBe(testUser.id);
    });
  });

  // ---- saveRecipeFromChat — additional exit paths (H9) ----

  describe("saveRecipeFromChat — exit paths", () => {
    // Shared valid recipe metadata fixture — mirrors lineage test above.
    const validMetadata = {
      metadataVersion: 1,
      recipe: {
        title: "test-Chicken Salad",
        description: "A light salad",
        difficulty: "Easy",
        timeEstimate: "15 min",
        servings: 2,
        ingredients: [{ name: "Chicken", quantity: "200", unit: "g" }],
        instructions: ["Grill chicken", "Toss salad"],
        dietTags: ["gluten-free"],
      },
      allergenWarning: null,
      imageUrl: null,
    } as const;

    it("returns null when conversationId is owned by a different user", async () => {
      const otherUser = await createTestUser(tx);
      // Conversation owned by otherUser
      const conv = await createChatConversation(
        otherUser.id,
        "Other Chat",
        "recipe",
      );
      const msg = await createChatMessage(
        conv.id,
        otherUser.id,
        "assistant",
        "Recipe!",
        validMetadata,
      );

      // testUser attempts to save from otherUser's conversation
      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).toBeNull();
      // Side-effect assertion: no recipe row must be written for the attempted message
      const leaked = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.sourceMessageId, msg.id));
      expect(leaked).toHaveLength(0);
    });

    it("returns null when message metadata is null", async () => {
      const conv = await createChatConversation(
        testUser.id,
        "test-Chat",
        "recipe",
      );
      // createChatMessage with no metadata stores null in the DB
      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "assistant",
        "No metadata here",
      );

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).toBeNull();
    });

    it("returns null when metadata fails Zod validation (invalid schema)", async () => {
      const conv = await createChatConversation(
        testUser.id,
        "test-Chat",
        "recipe",
      );
      // Metadata that looks like JSON but is not a valid recipeChatMetadataSchema
      // (missing 'recipe' field entirely; no savedRecipeId so we don't hit legacy path)
      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "assistant",
        "Bad metadata",
        { metadataVersion: 1, unexpectedField: true },
      );

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).toBeNull();
    });

    it("returns existing recipe via onConflictDoNothing when sourceMessageId already exists", async () => {
      const conv = await createChatConversation(
        testUser.id,
        "test-Chat",
        "recipe",
      );
      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "assistant",
        "Recipe!",
        validMetadata,
      );

      // Pre-insert a communityRecipe with the same sourceMessageId to simulate
      // a prior save (e.g. from a concurrent request). This exercises the
      // onConflictDoNothing → fetch-existing branch (lines 113-120).
      // The unique constraint that fires is on sourceMessageId (confirmed by the
      // fallback SELECT in recipe-from-chat.ts). normalizedProductName is
      // recipe.title.toLowerCase() = "test-chicken salad" — matches here.
      const [preInserted] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          normalizedProductName: "test-chicken salad",
          title: "test-Chicken Salad",
          instructions: ["Grill chicken", "Toss salad"],
          sourceMessageId: msg.id,
        })
        .returning();

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(preInserted.id);
      // Ownership assertion: conflict-fallback must return the requesting user's recipe
      expect(result!.authorId).toBe(testUser.id);
    });

    it("returns existing recipe when metadata already has savedRecipeId (legacy path)", async () => {
      // First, create the recipe we'll reference
      const [existingRecipe] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          normalizedProductName: "test-saved recipe",
          title: "test-Saved Recipe",
          instructions: ["Step 1"],
        })
        .returning();

      const conv = await createChatConversation(
        testUser.id,
        "test-Chat",
        "recipe",
      );
      // Message already has savedRecipeId in metadata — legacy back-reference
      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "assistant",
        "Already saved!",
        { savedRecipeId: existingRecipe.id },
      );

      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(existingRecipe.id);
    });

    it("returns null when legacy savedRecipeId references another user's private recipe (IDOR guard)", async () => {
      const otherUser = await createTestUser(tx);
      // Other user owns the recipe
      const [otherRecipe] = await tx
        .insert(communityRecipes)
        .values({
          authorId: otherUser.id,
          normalizedProductName: "test-other recipe",
          title: "test-Other Recipe",
          instructions: ["Step 1"],
        })
        .returning();

      const conv = await createChatConversation(
        testUser.id,
        "test-Chat",
        "recipe",
      );
      // testUser's message contains a savedRecipeId pointing to otherUser's recipe
      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "assistant",
        "Forged savedRecipeId!",
        { savedRecipeId: otherRecipe.id },
      );

      // Must return null — authorId filter in legacy path blocks cross-user access.
      // The legacy path is read-only (SELECT only), so no new row is written.
      const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
      expect(result).toBeNull();

      // Confirm otherRecipe was not mutated or reassigned by the failed attempt.
      const [afterAttempt] = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.id, otherRecipe.id));
      expect(afterAttempt).toBeDefined();
      expect(afterAttempt!.authorId).toBe(otherUser.id);
    });

    it("persists mealTypes on the created recipe", async () => {
      const conv = await createChatConversation(
        testUser.id,
        "test-Chat",
        "recipe",
      );
      const msg = await createChatMessage(
        conv.id,
        testUser.id,
        "assistant",
        "Recipe with meal types!",
        validMetadata,
      );

      const mealTypes = ["breakfast", "lunch"];
      const result = await saveRecipeFromChat(
        msg.id,
        conv.id,
        testUser.id,
        undefined,
        mealTypes,
      );

      expect(result).not.toBeNull();
      expect(result!.mealTypes).toEqual(mealTypes);
    });
  });
});
