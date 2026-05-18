import {
  type CommunityRecipe,
  chatConversations,
  chatMessages,
  communityRecipes,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { recipeChatMetadataSchema } from "@shared/schemas/recipe-chat";
import { deriveRecipeAllergens } from "@shared/constants/allergens";

// ============================================================================
// CROSS-DOMAIN: RECIPE CHAT — SAVE RECIPE FROM CHAT
// ============================================================================

/**
 * Save a recipe from a chat message to communityRecipes.
 * Atomic transaction: verify ownership, check idempotency, create recipe,
 * update message metadata with back-reference.
 *
 * For remix conversations, pass remixedFromId and remixedFromTitle to
 * establish lineage to the original recipe.
 *
 * Returns the created recipe, or the existing one if already saved.
 */
export async function saveRecipeFromChat(
  messageId: number,
  conversationId: number,
  userId: string,
  lineage?: { remixedFromId: number; remixedFromTitle: string },
  mealTypes?: string[],
): Promise<CommunityRecipe | null> {
  return db.transaction(async (tx) => {
    // 1. Verify conversation ownership
    const [conv] = await tx
      .select()
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.userId, userId),
        ),
      );
    if (!conv) return null;

    // 2. Get the message and check it belongs to this conversation
    const [msg] = await tx
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, messageId),
          eq(chatMessages.conversationId, conversationId),
        ),
      );
    if (!msg || !msg.metadata) return null;

    // 3. Validate metadata with Zod — no unsafe `as` casts on DB values
    const parsed = recipeChatMetadataSchema.safeParse(msg.metadata);

    // 4. Extract validated recipe data from metadata
    if (!parsed.success) {
      // Handle legacy or non-recipe messages: check raw savedRecipeId for idempotency.
      // Use parseInt (not Number) to avoid NaN/0 coercion; add authorId ownership filter
      // so a crafted savedRecipeId cannot surface another user's recipe. (M13 — 2026-04-18)
      const rawMetadata: unknown = msg.metadata;
      const savedRecipeId =
        rawMetadata !== null &&
        typeof rawMetadata === "object" &&
        "savedRecipeId" in rawMetadata
          ? (rawMetadata as Record<string, unknown>).savedRecipeId
          : undefined;
      if (savedRecipeId) {
        const legacyId = parseInt(String(savedRecipeId), 10);
        if (legacyId > 0) {
          const [existing] = await tx
            .select()
            .from(communityRecipes)
            .where(
              and(
                eq(communityRecipes.id, legacyId),
                eq(communityRecipes.authorId, userId),
              ),
            );
          return existing || null;
        }
      }
      return null;
    }
    const { recipe } = parsed.data;

    // 5. Create communityRecipe (private by default). mealTypes must be
    //    pre-computed by the caller (storage-layer purity — M5).
    //    Idempotent via sourceMessageId conflict guard (P3-T21).
    //    `allergens` is derived inline from ingredient names via the pure
    //    `deriveRecipeAllergens` shared function — always a concrete array so
    //    the recipe is never a fail-closed `null` row on the search filter.
    const allergens = deriveRecipeAllergens(
      recipe.ingredients.map((i) => i.name),
    );
    const [created] = await tx
      .insert(communityRecipes)
      .values({
        authorId: userId,
        normalizedProductName: recipe.title.toLowerCase(),
        title: recipe.title,
        description: recipe.description,
        difficulty: recipe.difficulty,
        timeEstimate: recipe.timeEstimate,
        servings: recipe.servings ?? 2,
        dietTags: recipe.dietTags ?? [],
        mealTypes: mealTypes ?? [],
        allergens,
        instructions: recipe.instructions,
        ingredients: recipe.ingredients,
        imageUrl: parsed.data.imageUrl ?? null,
        isPublic: false,
        sourceMessageId: messageId,
        ...(lineage && {
          remixedFromId: lineage.remixedFromId,
          remixedFromTitle: lineage.remixedFromTitle,
        }),
      })
      .onConflictDoNothing()
      .returning();

    if (!created) {
      // Conflict — recipe already exists for this message (retry path). Fetch existing.
      const [existing] = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.sourceMessageId, messageId));
      return existing ?? null;
    }

    // 6. Update message metadata with back-reference
    await tx
      .update(chatMessages)
      .set({
        metadata: sql`${chatMessages.metadata} || ${JSON.stringify({ savedRecipeId: created.id })}::jsonb`,
      })
      .where(eq(chatMessages.id, messageId));

    return created;
  });
}
