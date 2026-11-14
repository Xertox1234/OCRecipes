import type {
  FoodCardEdits,
  FoodCardPayload,
  GroceryCardEdits,
  GroceryCardPayload,
  PlanCardEdits,
  PlanCardPayload,
  WriteCardEdits,
  WriteCardKind,
  WriteCardMealType,
  WriteCardPayload,
} from "../schemas/coach-write-cards";

/**
 * Pure write-card arithmetic and copy, shared so the card's button, the
 * server's save and the receipt can never disagree on a total or a count.
 */

const MEAL_LABEL: Record<WriteCardMealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export function mealLabel(mealType: WriteCardMealType): string {
  return MEAL_LABEL[mealType];
}

export function foodCounts(p: FoodCardPayload, e: FoodCardEdits): number[] {
  return p.items.map((item, i) => e.counts?.[i] ?? item.count);
}

export function foodTotal(p: FoodCardPayload, e: FoodCardEdits): number {
  const counts = foodCounts(p, e);
  const raw = p.items.reduce(
    (sum, item, i) => sum + item.perUnit.calories * counts[i],
    0,
  );
  return Math.round(raw);
}

export function groceryKept(
  p: GroceryCardPayload,
  e: GroceryCardEdits,
): GroceryCardPayload["items"] {
  return p.items.filter((item, i) => e.ticked?.[i] ?? item.ticked);
}

export type KeptPlanRow = Omit<PlanCardPayload["rows"][number], "alternatives">;

export function planKept(p: PlanCardPayload, e: PlanCardEdits): KeptPlanRow[] {
  const kept: KeptPlanRow[] = [];
  p.rows.forEach((row, i) => {
    if (e.removed?.[i]) return;
    const choice = e.chosen?.[i];
    const recipe =
      choice != null && row.alternatives[choice]
        ? row.alternatives[choice]
        : row.recipe;
    kept.push({
      plannedDate: row.plannedDate,
      mealType: row.mealType,
      recipe,
      alreadyPlanned: row.alreadyPlanned,
    });
  });
  return kept;
}

function plural(n: number, word: string): string {
  if (n === 1) return `${n} ${word}`;
  // "lunch" is the one meal type that takes -es.
  return `${n} ${word}${/(ch|sh|s|x)$/.test(word) ? "es" : "s"}`;
}

/** "3 dinners" when every row shares a meal type, else "3 meals". */
function planNoun(rows: KeptPlanRow[]): string {
  const types = new Set(rows.map((r) => r.mealType));
  const word = types.size === 1 ? [...types][0] : "meal";
  return plural(rows.length, word);
}

export function writeCardButtonLabel(
  kind: WriteCardKind,
  p: WriteCardPayload,
  e: WriteCardEdits,
): string {
  switch (kind) {
    case "food":
      return `Log ${foodTotal(p as FoodCardPayload, e as FoodCardEdits)} cal`;
    case "grocery": {
      const n = groceryKept(
        p as GroceryCardPayload,
        e as GroceryCardEdits,
      ).length;
      return `Add ${plural(n, "item")}`;
    }
    case "plan":
      return `Add ${planNoun(planKept(p as PlanCardPayload, e as PlanCardEdits))} to plan`;
  }
}

export function writeCardReceipt(
  kind: WriteCardKind,
  p: WriteCardPayload,
  e: WriteCardEdits,
  listTitle?: string,
): string {
  switch (kind) {
    case "food": {
      const fp = p as FoodCardPayload;
      const fe = e as FoodCardEdits;
      return `✓ Logged to ${mealLabel(fe.mealType ?? fp.mealType)} · ${foodTotal(fp, fe)} cal`;
    }
    case "grocery": {
      const n = groceryKept(
        p as GroceryCardPayload,
        e as GroceryCardEdits,
      ).length;
      return `✓ Added ${plural(n, "item")}${listTitle ? ` to ${listTitle}` : ""}`;
    }
    case "plan":
      return `✓ ${planNoun(planKept(p as PlanCardPayload, e as PlanCardEdits))} added`;
  }
}
