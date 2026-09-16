/**
 * Wire schemas for the receipt endpoints (POST /api/receipt/scan,
 * POST /api/receipt/confirm). Moved from client/hooks/useReceiptScan.ts on
 * 2026-09-14 so the server test suite can assert the route output against the
 * exact schema the client parses with (Lane A contract tests). Shapes mirror
 * the JSON wire format, not the Drizzle/server types — timestamps and decimal
 * quantities arrive as strings. On the scan response, `category` is kept as a
 * plain string (the server enum is validated server-side) for forward-compat
 * with new categories.
 */
import { z } from "zod";

export const receiptItemSchema = z.object({
  name: z.string(),
  originalName: z.string(),
  quantity: z.number(),
  unit: z.string().optional(),
  category: z.string(),
  isFood: z.boolean(),
  estimatedShelfLifeDays: z.number(),
  confidence: z.number(),
});

export const receiptAnalysisResultSchema = z.object({
  items: z.array(receiptItemSchema),
  storeName: z.string().optional(),
  purchaseDate: z.string().optional(),
  totalAmount: z.string().optional(),
  isPartialExtraction: z.boolean(),
  overallConfidence: z.number(),
});

/** Wire shape of a `PantryItem` row after JSON serialization. */
export const receiptPantryItemSchema = z.object({
  id: z.number(),
  userId: z.string(),
  name: z.string(),
  quantity: z.string().nullable(),
  unit: z.string().nullable(),
  category: z.string().nullable(),
  expiresAt: z.string().nullable(),
  addedAt: z.string(),
  updatedAt: z.string(),
});

export const receiptConfirmResultSchema = z.object({
  added: z.number(),
  items: z.array(receiptPantryItemSchema),
});

export type ReceiptItem = z.infer<typeof receiptItemSchema>;
export type ReceiptAnalysisResult = z.infer<typeof receiptAnalysisResultSchema>;
export type ReceiptConfirmResult = z.infer<typeof receiptConfirmResultSchema>;
