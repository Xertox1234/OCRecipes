import type { LocalMenuItem } from "@/lib/menu-ocr-parser";
import type { MenuAnalysisItem } from "@/hooks/useMenuScan";

/**
 * Returns true if the AI result should replace the local OCR preview.
 * Triggers when local had no items, or when AI found 50%+ more items.
 */
export function shouldReplaceWithAIMenu(
  local: LocalMenuItem[],
  aiItems: MenuAnalysisItem[],
): boolean {
  if (local.length === 0) return true;
  return aiItems.length >= local.length * 1.5;
}
