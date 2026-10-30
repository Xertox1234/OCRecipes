import type { PantryItem } from "@shared/schema";
import {
  type AggregatedGroceryItem,
  parseQuantityForSum,
  roundQuantity,
} from "./grocery-generation";

/**
 * Normalize a name for matching: lowercase, trim, collapse whitespace.
 */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Deduct pantry items from a grocery list.
 * Match by normalized name and exact unit. Same unit → subtract quantity.
 * Result <= 0 → remove. No unit match → keep.
 * Pure function, no DB access.
 */
export function deductPantryFromGrocery(
  groceryItems: AggregatedGroceryItem[],
  pantryItems: PantryItem[],
): AggregatedGroceryItem[] {
  // Build a lookup: normalized name + unit → total pantry quantity
  const pantryMap = new Map<string, number>();
  for (const p of pantryItems) {
    const name = normalizeName(p.name);
    const unit = p.unit?.toLowerCase().trim() || "";
    const key = `${name}|${unit}`;
    const qty = parseQuantityForSum(p.quantity) ?? 0;
    pantryMap.set(key, roundQuantity((pantryMap.get(key) || 0) + qty));
  }

  const result: AggregatedGroceryItem[] = [];

  for (const item of groceryItems) {
    const name = normalizeName(item.name);
    const unit = item.unit?.toLowerCase().trim() || "";
    const key = `${name}|${unit}`;

    const pantryQty = pantryMap.get(key);

    if (pantryQty === undefined) {
      // No pantry match — keep as is
      result.push(item);
      continue;
    }

    if (item.quantity === null || pantryQty <= 0) {
      // No quantity to subtract, or pantry is exhausted — keep
      result.push(item);
      continue;
    }

    const remaining = roundQuantity(item.quantity - pantryQty);
    // Consume from pantry map so further items with same key are handled
    pantryMap.set(key, Math.max(0, roundQuantity(pantryQty - item.quantity)));

    if (remaining > 0) {
      result.push({ ...item, quantity: remaining });
    }
    // If remaining <= 0, item is fully covered by pantry — omit from grocery
  }

  return result;
}
