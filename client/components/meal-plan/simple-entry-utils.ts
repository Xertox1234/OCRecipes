/**
 * Pure maths and copy for the Simple Entry review step: the foods an estimate
 * found, each with an amount the person can change before saving.
 * No React or RN dependencies, so Vitest covers it directly.
 */
import type { ParsedFoodItem } from "@/hooks/useFoodParse";
import type { MealType } from "./meal-plan-utils";

interface RowNutrition {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface EntryRow {
  /** Stable React key. */
  id: string;
  name: string;
  unit: string;
  /** The amount the estimate assumed; everything scales from it. */
  baseQuantity: number;
  /** The amount the person has set. */
  quantity: number;
  /** Weight of the base amount, when the estimate gave one. */
  baseGrams: number | null;
  /** Nutrition of the base amount; null where the lookup found nothing. */
  base: RowNutrition;
  /** False when the estimate could not size the portion and fell back to 100 g. */
  portionKnown: boolean;
  /** Added as a drink or side, not part of the dish the person typed. */
  isExtra: boolean;
}

export interface EntryTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const MAX_ROW_QUANTITY = 99;
const MAX_WEIGHED_QUANTITY = 5000;

const HALF_STEP_UNITS = new Set([
  "cup",
  "tablespoon",
  "tbsp",
  "teaspoon",
  "tsp",
  "oz",
  "ounce",
  "bowl",
  "glass",
]);
const WEIGHED_UNITS = new Set(["g", "gram", "ml", "millilitre", "milliliter"]);
const WEIGHED_STEP = 25;

/** "Cups" → "cup", "glasses" → "glass": the known unit a plural names, if any. */
function unitKey(unit: string): string {
  const key = unit.trim().toLowerCase();
  const known = (k: string) => WEIGHED_UNITS.has(k) || HALF_STEP_UNITS.has(k);
  const candidates = [key, key.replace(/s$/, ""), key.replace(/es$/, "")];
  return candidates.find(known) ?? key;
}

function isWeighed(unit: string): boolean {
  return WEIGHED_UNITS.has(unitKey(unit));
}

/** How far one tap of the stepper moves an amount in this unit. */
export function stepFor(unit: string): number {
  const key = unitKey(unit);
  if (WEIGHED_UNITS.has(key)) return WEIGHED_STEP;
  return HALF_STEP_UNITS.has(key) ? 0.5 : 1;
}

/** The server writes a sized portion as "3 slices (24 g)". */
function gramsFrom(servingSize: string | null): number | null {
  const match = servingSize?.match(/\((\d+(?:\.\d+)?)\s*g\)/);
  return match ? Number(match[1]) : null;
}

function isUnknownPortion(servingSize: string | null): boolean {
  return servingSize?.includes("portion unknown") ?? false;
}

export function toEntryRows(
  items: ParsedFoodItem[],
  opts: { isExtra: boolean; idPrefix: string },
): EntryRow[] {
  return items.map((item, index) => {
    const base: RowNutrition = {
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    };
    const shared = {
      id: `${opts.idPrefix}-${index}`,
      name: item.name,
      base,
      isExtra: opts.isExtra,
    };
    // The nutrition is for 100 g, whatever amount was typed, so the row is
    // shown and adjusted as a weight: that is the only honest handle on it.
    if (isUnknownPortion(item.servingSize)) {
      return {
        ...shared,
        unit: "g",
        baseQuantity: 100,
        quantity: 100,
        baseGrams: 100,
        portionKnown: false,
      };
    }
    const quantity =
      Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
    return {
      ...shared,
      unit: item.unit,
      baseQuantity: quantity,
      quantity,
      baseGrams: gramsFrom(item.servingSize),
      portionKnown: true,
    };
  });
}

/**
 * One tap of a row's stepper. Returns null when the amount would drop below
 * one step, which removes the row.
 */
export function stepRow(row: EntryRow, direction: 1 | -1): EntryRow | null {
  const step = stepFor(row.unit);
  const max = isWeighed(row.unit) ? MAX_WEIGHED_QUANTITY : MAX_ROW_QUANTITY;
  const next = Math.min(max, row.quantity + direction * step);
  if (next < step) return null;
  return { ...row, quantity: next };
}

/** True when the next tap down removes the row instead of shrinking it. */
export function isAtMinimum(row: EntryRow): boolean {
  return stepRow(row, -1) === null;
}

function factor(row: EntryRow): number {
  return row.quantity / row.baseQuantity;
}

function scaled(row: EntryRow, value: number | null): number {
  return (value ?? 0) * factor(row);
}

export function rowCalories(row: EntryRow): number | null {
  return row.base.calories == null
    ? null
    : Math.round(row.base.calories * factor(row));
}

/** "1.5", "2": at most one decimal, no trailing zero. */
export function formatAmount(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** "4 slices · 32 g"; a weighed row is just "125 g". */
export function rowAmountLabel(row: EntryRow): string {
  const amount = [formatAmount(row.quantity), row.unit.trim()]
    .filter(Boolean)
    .join(" ");
  if (row.baseGrams == null || isWeighed(row.unit)) return amount;
  return `${amount} · ${Math.round(row.baseGrams * factor(row))} g`;
}

export function rowCaption(row: EntryRow): string {
  const calories = rowCalories(row);
  if (calories == null) return "No estimate";
  return row.portionKnown
    ? `${calories} kcal`
    : `Portion unknown · ${calories} kcal`;
}

/** Sums the scaled rows; a missing estimate counts as zero. Rounded once. */
export function entryTotals(rows: EntryRow[]): EntryTotals {
  const sum = (pick: (base: RowNutrition) => number | null) =>
    Math.round(
      rows.reduce((total, row) => total + scaled(row, pick(row.base)), 0),
    );
  return {
    calories: sum((b) => b.calories),
    protein: sum((b) => b.protein),
    carbs: sum((b) => b.carbs),
    fat: sum((b) => b.fat),
  };
}

export function formatTotalsLine(totals: EntryTotals): string {
  return `${totals.protein} g protein · ${totals.carbs} g carbs · ${totals.fat} g fat`;
}

/**
 * Identifies a saved quick-entry recipe by what was saved, so a retry after a
 * failed add reuses it only while the name and the numbers are unchanged.
 */
export function retryKey(title: string, totals: EntryTotals): string {
  return [
    title,
    totals.calories,
    totals.protein,
    totals.carbs,
    totals.fat,
  ].join("|");
}

const LUNCH_AND_DINNER = ["Water", "Side salad", "Bread", "Rice", "Fries"];
const SUGGESTIONS: Record<MealType, string[]> = {
  breakfast: ["Coffee", "Tea", "Orange juice", "Toast", "Fruit"],
  lunch: LUNCH_AND_DINNER,
  dinner: LUNCH_AND_DINNER,
  snack: ["Coffee", "Tea", "Fruit"],
};

/** Drinks and sides to offer for a meal, minus any already in the entry. */
export function suggestionsFor(mealType: MealType, rows: EntryRow[]): string[] {
  const present = new Set(rows.map((row) => row.name.trim().toLowerCase()));
  return SUGGESTIONS[mealType].filter(
    (name) => !present.has(name.toLowerCase()),
  );
}
