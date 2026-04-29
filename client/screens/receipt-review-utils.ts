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
 * Merges local OCR skeleton with AI-expanded items.
 * Currently returns AI items directly — AI always has superior names
 * (abbreviations expanded, categories assigned).
 *
 * TODO: Use `_local` to fall back to locally-parsed items for any AI items
 * whose confidence is below a threshold, preserving raw OCR data when the
 * AI result is uncertain.
 */
export function mergeReceiptItems(
  _local: LocalReceiptItem[],
  aiItems: ReceiptItem[],
): ReceiptItem[] {
  return aiItems;
}
