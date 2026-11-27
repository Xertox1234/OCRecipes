import type { LabelCompareBlock } from "@shared/schemas/coach-blocks";

/**
 * Pure helpers for the compare card (Coach roadmap T4), so LabelCompare.tsx
 * stays thin and Vitest covers the rows and the spoken text. Each product is
 * per its own serving; nothing is scaled.
 */

type Item = LabelCompareBlock["items"][number];
type Pair = LabelCompareBlock["items"];

const NUTRIENTS = [
  { key: "calories", label: "Calories", unit: "", spoken: "" },
  { key: "protein", label: "Protein", unit: "g", spoken: "grams" },
  { key: "carbs", label: "Carbs", unit: "g", spoken: "grams" },
  { key: "fat", label: "Fat", unit: "g", spoken: "grams" },
  { key: "fiber", label: "Fiber", unit: "g", spoken: "grams" },
  { key: "sugar", label: "Sugar", unit: "g", spoken: "grams" },
  { key: "sodium", label: "Sodium", unit: "mg", spoken: "milligrams" },
] as const;

function number(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function shown(value: number | null, unit: string): string {
  if (value === null) return "—";
  return unit ? `${number(value)} ${unit}` : number(value);
}

function said(value: number | null, unit: string): string {
  if (value === null) return "not listed";
  return unit ? `${number(value)} ${unit}` : number(value);
}

export interface CompareRow {
  label: string;
  a: string;
  b: string;
  spoken: string;
}

/** One row per nutrient at least one of the two labels lists. */
export function compareRows([a, b]: Pair): CompareRow[] {
  // Each spoken value names its product, so a listener need not hold the
  // column order from the opening sentence.
  return NUTRIENTS.filter((n) => a[n.key] !== null || b[n.key] !== null).map(
    (n) => ({
      label: n.label,
      a: shown(a[n.key], n.unit),
      b: shown(b[n.key], n.unit),
      spoken: `${n.label}: ${said(a[n.key], n.spoken)} for ${a.name}, ${said(b[n.key], n.spoken)} for ${b.name}`,
    }),
  );
}

/** "per 1 bar (40 g)", or "per serving" where the label gave no size. */
export function servingLine(item: Item): string {
  const size = item.servingSize?.trim();
  return size ? `per ${size}` : "per serving";
}

function named(item: Item): string {
  return item.brand ? `${item.name} by ${item.brand}` : item.name;
}

export function compareSpoken(pair: Pair): string {
  const [a, b] = pair;
  return [
    `Comparing ${named(a)}, ${servingLine(a)}, and ${named(b)}, ${servingLine(b)}`,
    ...compareRows(pair).map((r) => r.spoken),
  ].join(". ");
}
