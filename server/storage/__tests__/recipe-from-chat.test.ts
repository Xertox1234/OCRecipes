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
import { eq } from "drizzle-orm";
import type { RecipeChatMetadata } from "@shared/schemas/recipe-chat";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { saveRecipeFromChat } = await import("../recipe-from-chat");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/**
 * Per-test unique seq for recipe titles. `saveRecipeFromChat` calls
 * `db.transaction()` internally; if any savepoint leak occurs, distinct
 * titles avoid unique-constraint collisions on `community_recipes`.
 */
let recipeSeq = 0;
function uniqueTitle(prefix: string): string {
  recipeSeq++;
  return `${prefix} ${Date.now()} ${recipeSeq}`;
}

function buildRecipeMetadata(titleOverride?: string): RecipeChatMetadata {
  return {
    metadataVersion: 1,
    recipe: {
      title: titleOverride ?? uniqueTitle("Test Recipe"),
      description: "A test recipe",
      difficulty: "easy",
      timeEstimate: "30 minutes",
      servings: 2,
      ingredients: [{ name: "flour", quantity: "1", unit: "cup" }],
      instructions: ["Mix", "Bake"],
      dietTags: ["vegetarian"],
    },
    allergenWarning: null,
    imageUrl: null,
  };
}

async function createConversationWithMessage(opts: {
  userId: string;
  metadata: RecipeChatMetadata | Record<string, unknown> | null;
}): Promise<{ conversationId: number; messageId: number }> {
  const [conv] = await tx
    .insert(chatConversations)
    .values({
      userId: opts.userId,
      title: "Recipe chat",
      type: "recipe",
    })
    .returning();
  const [msg] = await tx
    .insert(chatMessages)
    .values({
      conversationId: conv.id,
      role: "assistant",
      content: "Here's the recipe.",
      metadata: opts.metadata,
    })
    .returning();
  return { conversationId: conv.id, messageId: msg.id };
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

  describe("saveRecipeFromChat", () => {
    it("returns null when the conversation does not belong to the user", async () => {
      const otherUser = await createTestUser(tx);
      const { conversationId, messageId } = await createConversationWithMessage(
        { userId: otherUser.id, metadata: buildRecipeMetadata() },
      );

      const result = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
      );
      expect(result).toBeNull();
      // Dual-assertion: no community recipe leaked from the rejection path.
      const rows = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.sourceMessageId, messageId));
      expect(rows).toHaveLength(0);
    });

    it("returns null when the message belongs to a different conversation", async () => {
      const { conversationId } = await createConversationWithMessage({
        userId: testUser.id,
        metadata: buildRecipeMetadata(),
      });
      const other = await createConversationWithMessage({
        userId: testUser.id,
        metadata: buildRecipeMetadata(),
      });

      // Pass the message from the *other* conversation but the first conversationId.
      const result = await saveRecipeFromChat(
        other.messageId,
        conversationId,
        testUser.id,
      );
      expect(result).toBeNull();
      // Dual-assertion: no community recipe leaked from the rejection path.
      const rows = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.sourceMessageId, other.messageId));
      expect(rows).toHaveLength(0);
    });

    it("creates a community recipe from valid metadata and writes back the savedRecipeId", async () => {
      const metadata = buildRecipeMetadata();
      const { conversationId, messageId } = await createConversationWithMessage(
        { userId: testUser.id, metadata },
      );

      const recipe = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
      );
      expect(recipe).not.toBeNull();
      expect(recipe!.authorId).toBe(testUser.id);
      expect(recipe!.title).toBe(metadata.recipe.title);
      expect(recipe!.isPublic).toBe(false);
      expect(recipe!.sourceMessageId).toBe(messageId);

      // savedRecipeId is merged into the message metadata.
      const [updatedMsg] = await tx
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId));
      const md = updatedMsg.metadata as { savedRecipeId?: number };
      expect(md.savedRecipeId).toBe(recipe!.id);
    });

    it("is idempotent — calling twice returns the same recipe", async () => {
      const { conversationId, messageId } = await createConversationWithMessage(
        { userId: testUser.id, metadata: buildRecipeMetadata() },
      );

      const first = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
      );
      const second = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
      );
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!.id).toBe(first!.id);

      // Only one community_recipes row exists for this sourceMessageId — the
      // second call hit the onConflictDoNothing guard, not a fresh insert.
      const rows = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.sourceMessageId, messageId));
      expect(rows).toHaveLength(1);
    });

    it("records lineage when a remixedFrom hint is provided", async () => {
      // remixed_from_id is an FK to community_recipes — seed a real source row.
      const [source] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          normalizedProductName: uniqueTitle("test-source").toLowerCase(),
          title: "Source Recipe",
          instructions: ["Step 1"],
          isPublic: false,
        })
        .returning();

      const { conversationId, messageId } = await createConversationWithMessage(
        { userId: testUser.id, metadata: buildRecipeMetadata() },
      );

      const recipe = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
        { remixedFromId: source.id, remixedFromTitle: source.title },
      );
      expect(recipe).not.toBeNull();
      expect(recipe!.remixedFromId).toBe(source.id);
      expect(recipe!.remixedFromTitle).toBe("Source Recipe");
    });

    it("attaches mealTypes from caller-provided array", async () => {
      const { conversationId, messageId } = await createConversationWithMessage(
        { userId: testUser.id, metadata: buildRecipeMetadata() },
      );

      const recipe = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
        undefined,
        ["dinner"],
      );
      expect(recipe).not.toBeNull();
      expect(recipe!.mealTypes).toEqual(["dinner"]);
    });

    it("normalizes title, difficulty, and ingredient names before persisting", async () => {
      const metadata = buildRecipeMetadata(
        uniqueTitle("spicy thai basil chicken"),
      );
      const { conversationId, messageId } = await createConversationWithMessage(
        { userId: testUser.id, metadata },
      );

      const recipe = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
      );
      expect(recipe).not.toBeNull();
      // uniqueTitle appends a timestamp/seq suffix, so match the Title-Cased
      // prefix rather than asserting exact equality.
      expect(recipe!.title).toMatch(/^Spicy Thai Basil Chicken/);
      expect(recipe!.difficulty).toBe("Easy");
      const ingredients = recipe!.ingredients as { name: string }[];
      expect(ingredients[0]!.name).toBe("Flour");
      // normalizedProductName stays derived from the *normalized* title —
      // asserted against an independently-derived expected value (not
      // recipe!.title.toLowerCase(), which would be tautological since both
      // columns are written from the same normalizedTitle variable).
      expect(recipe!.normalizedProductName).toMatch(
        /^spicy thai basil chicken/,
      );
    });

    it("falls back to legacy savedRecipeId pointer when metadata fails validation", async () => {
      // Seed an existing community recipe owned by the user.
      const [existing] = await tx
        .insert(communityRecipes)
        .values({
          authorId: testUser.id,
          normalizedProductName: uniqueTitle("test-legacy").toLowerCase(),
          title: uniqueTitle("Legacy Recipe"),
          instructions: ["Step 1"],
          isPublic: false,
        })
        .returning();

      // Message metadata has only a savedRecipeId pointer (legacy shape).
      const { conversationId, messageId } = await createConversationWithMessage(
        {
          userId: testUser.id,
          metadata: { savedRecipeId: existing.id },
        },
      );

      const result = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe(existing.id);
    });

    it("does not surface a legacy savedRecipeId pointing to another user's recipe", async () => {
      const otherUser = await createTestUser(tx);
      const [foreign] = await tx
        .insert(communityRecipes)
        .values({
          authorId: otherUser.id,
          normalizedProductName: uniqueTitle("test-foreign").toLowerCase(),
          title: uniqueTitle("Foreign Recipe"),
          instructions: ["Step 1"],
          isPublic: false,
        })
        .returning();

      const { conversationId, messageId } = await createConversationWithMessage(
        {
          userId: testUser.id,
          metadata: { savedRecipeId: foreign.id },
        },
      );

      const result = await saveRecipeFromChat(
        messageId,
        conversationId,
        testUser.id,
      );
      expect(result).toBeNull();
      // Dual-assertion: the foreign recipe's authorId was not changed.
      const [foreignAfter] = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.id, foreign.id));
      expect(foreignAfter.authorId).toBe(otherUser.id);
    });
  });
});
