import type { PantryItem } from "@shared/schema";
import {
  type AggregatedGroceryItem,
  normalizeIngredientName,
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

/**
 * Match key for an item name: normalized, with the last word's plural ending
 * dropped ("apples" and "apple", "tomatoes" and "tomato", "berries" and
 * "berry" share a key). A blanket `(es|s)$` strip turned "apples" into "appl",
 * which never matched "apple". A final "ie" also becomes "y", so "cookie" and
 * "cookies" meet at the same key; the key is only compared, never shown.
 */
export function matchKey(name: string): string {
  const n = normalizeIngredientName(name);
  if (/ies?$/.test(n)) return n.replace(/ies?$/, "y");
  if (/(oes|ches|shes|xes|sses|zes)$/.test(n)) return n.replace(/es$/, "");
  if (/[^s]s$/.test(n)) return n.replace(/s$/, "");
  return n;
}

export const unitKey = (unit: string | null | undefined) =>
  unit?.toLowerCase().trim() ?? "";

export type PantryVerdict = "covered" | "unsure" | "buy";

/**
 * What the pantry says about one item. Only a clear answer leaves it off the
 * list: dropping an item the user still needs is the costly mistake, so a
 * match that cannot be judged keeps the item.
 *   - covered: nothing asked beyond the name, or the same unit holds enough.
 *   - unsure:  the pantry has it, in an unknown amount or another unit.
 *   - buy:     not there, or a known amount in the same unit that is too small.
 * Shared by Coach's grocery card and the plan card's shopping step.
 */
export function pantryVerdict(
  item: { quantity?: string | null; unit?: string | null },
  rows: PantryItem[],
): PantryVerdict {
  const stocked = rows.filter((r) => {
    const qty = parseQuantityForSum(r.quantity);
    return qty === null || qty > 0;
  });
  if (stocked.length === 0) return "buy";
  const need = parseQuantityForSum(item.quantity);
  if (need === null) return "covered";

  const unit = unitKey(item.unit);
  let have = 0;
  let judgeable = true;
  for (const r of stocked) {
    const qty = parseQuantityForSum(r.quantity);
    if (qty === null || unitKey(r.unit) !== unit) judgeable = false;
    else have += qty;
  }
  if (have >= need) return "covered";
  return judgeable ? "buy" : "unsure";
}

/** Pantry rows grouped by item match key, skipping expired ones. */
export function groupPantryByKey(
  pantry: PantryItem[],
  now: Date,
): Map<string, PantryItem[]> {
  const byKey = new Map<string, PantryItem[]>();
  for (const row of pantry) {
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) continue;
    const key = matchKey(row.name);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return byKey;
}
