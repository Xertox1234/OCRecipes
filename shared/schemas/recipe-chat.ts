/**
 * Zod schema for recipe chat message metadata.
 * Used by both server storage (chat.ts) and service (recipe-chat.ts) layers.
 */
import { z } from "zod";

/** Metadata stored in chatMessages.metadata for recipe responses */
export const recipeChatMetadataSchema = z.object({
  metadataVersion: z.literal(1),
  recipe: z.object({
    title: z.string(),
    description: z.string(),
    difficulty: z.string(),
    timeEstimate: z.string(),
    servings: z.number(),
    ingredients: z.array(
      z.object({
        name: z.string(),
        quantity: z.string(),
        unit: z.string(),
      }),
    ),
    instructions: z.array(z.string()),
    dietTags: z.array(z.string()),
  }),
  allergenWarning: z.string().nullable(),
  imageUrl: z.string().nullable(),
  savedRecipeId: z.number().optional(),
});

export type RecipeChatMetadata = z.infer<typeof recipeChatMetadataSchema>;

/** Metadata stored in chatConversations.metadata for remix conversations */
export const remixConversationMetadataSchema = z.object({
  sourceRecipeId: z.number().int().positive(),
  sourceRecipeTitle: z.string(),
});

export type RemixConversationMetadata = z.infer<
  typeof remixConversationMetadataSchema
>;
