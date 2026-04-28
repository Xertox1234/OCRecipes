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

/**
 * Merges AI macros into the displayed items when shouldReplaceWithAIMenu
 * returns false. Keeps local item names where a case-insensitive match
 * exists; takes the AI item as-is otherwise.
 */
export function mergeMenuItems(
  local: LocalMenuItem[],
  aiItems: MenuAnalysisItem[],
): MenuAnalysisItem[] {
  return aiItems.map((aiItem) => {
    const match = local.find(
      (l) => l.name.toLowerCase().trim() === aiItem.name.toLowerCase().trim(),
    );
    return match ? { ...aiItem, name: match.name } : aiItem;
  });
}
