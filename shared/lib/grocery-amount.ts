import { isMeasuredUnit } from "./grocery-parser";

/** The grocery parser's counted labels, which read better in the plural. */
const PLURALS: Record<string, string> = {
  cup: "cups",
  can: "cans",
  pack: "packs",
  jar: "jars",
  bottle: "bottles",
  bunch: "bunches",
  loaf: "loaves",
  bag: "bags",
  box: "boxes",
};

/**
 * The one way a grocery amount is written: "2 L", "2 × 500 g", "3 cans", "12".
 * Null when the item has no amount. Used by the list row, its spoken label,
 * the Share text and the add box's hint, so they cannot drift apart.
 *
 * `quantity` is the row's numeric string (or a parsed number). `count` is the
 * number of packs of a measured size; rows have no such column until the
 * amounts slice, so it defaults to 1. Units the parser does not own (anything
 * a generated list carries) are shown exactly as stored.
 */
export function formatGroceryAmount(amount: {
  quantity: string | number | null | undefined;
  unit: string | null | undefined;
  count?: number;
}): string | null {
  const quantity =
    typeof amount.quantity === "number"
      ? amount.quantity
      : parseFloat(amount.quantity ?? "");
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const unit = amount.unit || null;
  if (!unit) return String(quantity);

  const label = quantity === 1 ? unit : (PLURALS[unit] ?? unit);
  const size = `${quantity} ${label}`;
  const count = amount.count ?? 1;
  return count > 1 && isMeasuredUnit(unit) ? `${count} × ${size}` : size;
}
