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
 * Returns the AI-classified receipt items.
 *
 * A confidence-based per-item fallback to locally-parsed OCR items was
 * considered and deliberately dropped: `LocalReceiptItem` and `ReceiptItem`
 * share no id/index correspondence key, and AI name expansion (e.g.
 * "ORG BNS CKEN" → "Organic Boneless Chicken") makes fuzzy `rawName` matching
 * unreliable. This function only runs after `shouldReplaceWithAIReceipt` has
 * already decided the AI result wins at the whole-result level, so a per-item
 * fallback would also contradict that decision. The local OCR data still
 * powers the instant skeleton preview before the AI scan resolves.
 */
export function mergeReceiptItems(aiItems: ReceiptItem[]): ReceiptItem[] {
  return aiItems;
}
