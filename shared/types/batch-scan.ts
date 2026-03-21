import { z } from "zod";

// Phase 1: Barcode-only BatchItem with discriminated union on status
const batchItemBaseSchema = z.object({
  id: z.string().min(1),
  barcode: z.string().optional(),
  productName: z.string().min(1).max(500),
  brandName: z.string().max(200).optional(),
  servingSize: z.string().max(100).optional(),
  quantity: z.number().int().min(1).max(99),
});

const pendingBatchItemSchema = batchItemBaseSchema.extend({
  status: z.literal("pending"),
});

const resolvedBatchItemSchema = batchItemBaseSchema.extend({
  status: z.literal("resolved"),
  calories: z.number().min(0).max(50000),
  protein: z.number().min(0).max(5000),
  carbs: z.number().min(0).max(5000),
  fat: z.number().min(0).max(5000),
});

const errorBatchItemSchema = batchItemBaseSchema.extend({
  status: z.literal("error"),
  errorMessage: z.string(),
});

export const batchItemSchema = z.discriminatedUnion("status", [
  pendingBatchItemSchema,
  resolvedBatchItemSchema,
  errorBatchItemSchema,
]);

export type BatchItem = z.infer<typeof batchItemSchema>;
export type ResolvedBatchItem = z.infer<typeof resolvedBatchItemSchema>;
export type PendingBatchItem = z.infer<typeof pendingBatchItemSchema>;
export type ErrorBatchItem = z.infer<typeof errorBatchItemSchema>;

export type BatchDestination = "daily_log" | "pantry" | "grocery_list";

export const batchSaveRequestSchema = z.object({
  items: z.array(resolvedBatchItemSchema).min(1).max(50),
  destination: z.enum(["daily_log", "pantry", "grocery_list"]),
  groceryListId: z.number().int().positive().optional(),
  mealType: z.string().max(50).optional(),
});

export type BatchSaveRequest = z.infer<typeof batchSaveRequestSchema>;
