import { formatGroceryAmount } from "@shared/lib/grocery-amount";
import { categorizeIngredient } from "@shared/lib/grocery-categories";
import { parseGroceryText, tidyGroceryName } from "@shared/lib/grocery-parser";

export interface GroceryAdd {
  /** What the add request sends. The server files the item under its aisle. */
  fields: { name: string; quantity: string | null; unit: string | null };
  /** One line under the add box saying what the text will become. */
  hint: string;
}

/** "dairy" → "Dairy": the same heading the list's sections show. */
export function aisleTitle(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Turn the add box's text into the fields to send and the hint to show, from
 * one parse, so the hint always says what will be stored. Null for blank text.
 */
export function buildGroceryAdd(text: string): GroceryAdd | null {
  if (!text.trim()) return null;
  const parsed = parseGroceryText(text);
  // "Milk 2L x2" is two packs of 2 L. A list row cannot hold a pack count
  // until the amounts slice adds the column, so keep the text whole for now.
  const fields: GroceryAdd["fields"] =
    parsed.count > 1 || parsed.quantity === null
      ? { name: tidyGroceryName(text), quantity: null, unit: null }
      : {
          name: parsed.name,
          quantity: String(parsed.quantity),
          unit: parsed.unit,
        };
  const amount = formatGroceryAmount(fields);
  const aisle = aisleTitle(categorizeIngredient(fields.name));
  return {
    fields,
    hint: `Becomes ${fields.name}${amount ? ` · ${amount}` : ""}, under ${aisle}`,
  };
}
