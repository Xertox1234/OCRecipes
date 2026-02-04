import { z } from "zod";
import { savedItemTypes } from "../schema";

export const savedItemTypeSchema = z.enum(savedItemTypes);

export const createSavedItemSchema = z.object({
  type: savedItemTypeSchema,
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  description: z.string().max(2000).optional(),
  difficulty: z.string().max(50).optional(),
  timeEstimate: z.string().max(50).optional(),
  instructions: z.string().max(10000).optional(),
  sourceItemId: z.number().int().positive().optional(),
  sourceProductName: z.string().max(200).optional(),
});

export type CreateSavedItemInput = z.infer<typeof createSavedItemSchema>;
