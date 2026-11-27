import {
  allergenWord,
  type AllergyCardEdits,
  type AllergyCardPayload,
  FoodCardEdits,
  FoodCardPayload,
  GoalKey,
  GoalsCardEdits,
  GoalsCardPayload,
  GroceryCardEdits,
  GroceryCardPayload,
  PantryCardEdits,
  PantryCardPayload,
  PlanCardEdits,
  PlanCardPayload,
  planRecipeKey,
  REMINDER_LABELS,
  type RemindersCardEdits,
  type RemindersCardPayload,
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

export function pantryKept(
  p: PantryCardPayload,
  e: PantryCardEdits,
): PantryCardPayload["rows"] {
  return p.rows.filter((_, i) => e.ticked?.[i] ?? true);
}

/** The action as a word: the card never tells them apart by colour alone. */
export const PANTRY_ACTION_LABEL: Record<
  PantryCardPayload["rows"][number]["action"],
  string
> = { add: "Add", use: "Use", remove: "Remove" };

/** "2.00" → "2", "0.50" → "0.5"; text that is not a number is kept. */
function trimAmount(quantity: string): string {
  const n = Number(quantity);
  return quantity.trim() !== "" && Number.isFinite(n) ? String(n) : quantity;
}

function amountWithUnit(quantity: string | null, unit: string | null): string {
  return [quantity === null ? null : trimAmount(quantity), unit]
    .filter(Boolean)
    .join(" ");
}

/** A pantry row's amount as the card shows it: "12", "1 L of 2 L", "all (500 g)". */
export function pantryRowAmount(
  row: PantryCardPayload["rows"][number],
): string {
  const held = amountWithUnit(row.held, row.unit);
  if (row.action === "remove") return held;
  if (row.action === "add") return amountWithUnit(row.quantity, row.unit);
  if (row.all) return held ? `all (${held})` : "all";
  const used = amountWithUnit(row.quantity, row.unit);
  return held ? `${used} of ${held}` : used;
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

/** Whether saving also adds the shopping: the user's tick, else on exactly
 *  when the card has a shopping section (the user asked for the list). */
export function planShoppingOn(p: PlanCardPayload, e: PlanCardEdits): boolean {
  return e.addShopping ?? p.shopping !== undefined;
}

/**
 * The ingredient names the kept meals need, each once, in card order. A
 * preview: the save merges amounts and leaves off what the pantry covers.
 */
export function planShoppingNames(
  p: PlanCardPayload,
  e: PlanCardEdits,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of planKept(p, e)) {
    for (const name of p.shopping?.ingredients[planRecipeKey(row.recipe)] ??
      []) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name.trim());
    }
  }
  return names;
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

/** The goals card's value per row: the user's edit, else the proposal. */
export function goalsValues(p: GoalsCardPayload, e: GoalsCardEdits): number[] {
  return p.rows.map((row, i) => e.values?.[i] ?? row.proposed);
}

const GOAL_SHORT: Record<GoalKey, string> = {
  calories: "cal",
  protein: "g protein",
  carbs: "g carbs",
  fat: "g fat",
};

/** "2,000 cal · 150 g protein" for the goals card's rows. */
export function goalsSummary(p: GoalsCardPayload, e: GoalsCardEdits): string {
  const values = goalsValues(p, e);
  return p.rows
    .map(
      (row, i) => `${values[i].toLocaleString("en-US")} ${GOAL_SHORT[row.key]}`,
    )
    .join(" · ");
}

/** The reminders card's switch per row: the user's edit, else the proposal. */
export function remindersValues(
  p: RemindersCardPayload,
  e: RemindersCardEdits,
): boolean[] {
  return p.changes.map((row, i) => e.on?.[i] ?? row.on);
}

/** "Meal logging nudges off · Daily check-in on" for the card's rows. */
export function remindersSummary(
  p: RemindersCardPayload,
  e: RemindersCardEdits,
): string {
  const values = remindersValues(p, e);
  return p.changes
    .map((row, i) => `${REMINDER_LABELS[row.key]} ${values[i] ? "on" : "off"}`)
    .join(" · ");
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
    case "plan": {
      const pp = p as PlanCardPayload;
      const pe = e as PlanCardEdits;
      const noun = planNoun(planKept(pp, pe));
      // A combined card (A1) says what the one tap does.
      return pp.shopping && planShoppingOn(pp, pe)
        ? `Plan ${noun} + shopping`
        : `Add ${noun} to plan`;
    }
    case "pantry":
      return "Update pantry";
    case "goals":
      return "Update goals";
    case "allergy":
      return "Add to allergies";
    case "reminders":
      return "Update reminders";
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
    // The server's receipt counts what the save really changed
    // (write-cards/pantry.ts); this is the line when no counts exist.
    case "pantry":
      return "✓ Pantry updated";
    case "allergy": {
      const word = allergenWord((p as AllergyCardPayload).allergen);
      const severity = (e as AllergyCardEdits).severity;
      return `✓ ${word[0].toUpperCase()}${word.slice(1)} added to your allergies${severity ? ` · ${severity}` : ""}`;
    }
    case "goals":
      return `✓ Goals updated · ${goalsSummary(p as GoalsCardPayload, e as GoalsCardEdits)}`;
    case "reminders":
      return `✓ Reminders updated · ${remindersSummary(p as RemindersCardPayload, e as RemindersCardEdits)}`;
  }
}
