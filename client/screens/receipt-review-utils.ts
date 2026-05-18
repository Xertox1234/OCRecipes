import type { LocalReceiptItem } from "@/lib/receipt-ocr-parser";
import type {
  ReceiptItem,
  ReceiptAnalysisResult,
} from "@/hooks/useReceiptScan";

/**
 * Returns true if the AI result should replace the local OCR preview.
 * Triggers when: no local items, AI confidence > 0.7, or item count
 * differs by more than 20%.
 */
export function shouldReplaceWithAIReceipt(
  local: LocalReceiptItem[],
  aiResult: Pick<ReceiptAnalysisResult, "items" | "overallConfidence">,
): boolean {
  if (local.length === 0) return true;
  if (aiResult.overallConfidence > 0.7) return true;
  const diff = Math.abs(aiResult.items.length - local.length);
  return diff / local.length > 0.2;
}

/**
 * Returns the AI-classified receipt items for rendering.
 *
 * A per-item fallback to the local OCR skeleton is intentionally not done:
 * `LocalReceiptItem` and `ReceiptItem` share no id/index correspondence, and
 * the local shape lacks `category`, `isFood`, and `estimatedShelfLifeDays`.
 * The coarse local-vs-AI choice is already made by `shouldReplaceWithAIReceipt`.
 */
export function mergeReceiptItems(aiItems: ReceiptItem[]): ReceiptItem[] {
  return aiItems;
}
