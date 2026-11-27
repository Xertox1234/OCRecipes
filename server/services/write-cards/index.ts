import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  WRITE_CARD_EDITS_SCHEMAS,
  type FoodCardEdits,
  type AllergyCardEdits,
  type FoodCardPayload,
  type GoalsCardEdits,
  type GroceryCardEdits,
  type GroceryCardPayload,
  type PantryCardEdits,
  type PlanCardEdits,
  type PlanCardPayload,
  type RemindersCardEdits,
  type WriteCardEdits,
  type WriteCardKind,
  type WriteCardPayload,
} from "@shared/schemas/coach-write-cards";
import {
  foodCounts,
  groceryKept,
  mealLabel,
  planKept,
  planShoppingOn,
  writeCardReceipt,
} from "@shared/lib/coach-write-card-math";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import type { AfterCommit } from "../../storage/meal-plan-recipes-crud";
import { buildFoodPayload, performFoodSave, revertFoodSave } from "./food";
import {
  buildGroceryPayload,
  groceryReceipt,
  performGrocerySave,
  revertGrocerySave,
} from "./grocery";
import {
  buildPantryPayload,
  describePantry,
  pantryReceipt,
  performPantrySave,
  revertPantrySave,
} from "./pantry";
import {
  buildPlanPayload,
  performPlanSave,
  planReceipt,
  planShoppingList,
  revertPlanSave,
  startPlanImageJobs,
} from "./plan";
import {
  buildAllergyPayload,
  describeAllergy,
  performAllergySave,
  revertAllergySave,
} from "./allergy";
import {
  buildGoalsPayload,
  describeGoals,
  performGoalsSave,
  revertGoalsSave,
} from "./goals";
import {
  buildRemindersPayload,
  describeReminders,
  performRemindersSave,
  revertRemindersSave,
} from "./reminders";
import { WriteCardEditError } from "./errors";
import { readCardPayload, STALE_CARD_RECEIPT } from "./payload";
import type { WriteCardProposal } from "./tool-args";

export { WriteCardEditError };

export type { WriteCardOutcome, WriteCardProposal } from "./tool-args";
export { planGroceryCard, type GroceryCardPlan } from "./grocery";
export { planPantryCard, pantryRowLine, type PantryCardPlan } from "./pantry";
export { buildGoalsPayload, describeGoals } from "./goals";
export { buildRemindersPayload, describeReminders } from "./reminders";

export async function buildWriteCardPayload(
  p: WriteCardProposal,
  ctx: { userId: string; tz: string; now: Date },
): Promise<WriteCardPayload> {
  switch (p.kind) {
    case "food":
      return buildFoodPayload(p.args, { tz: ctx.tz, now: ctx.now });
    case "grocery":
      return buildGroceryPayload(p.args, ctx.userId);
    case "plan":
      return buildPlanPayload(p.args, ctx.userId, p.pool, {
        shopping: p.shopping,
      });
    case "pantry":
      return buildPantryPayload(p.args, ctx.userId);
    case "goals":
      return buildGoalsPayload(p.args, ctx.userId);
    case "allergy":
      return buildAllergyPayload(p.args, ctx.userId);
    case "reminders":
      return buildRemindersPayload(p.args, ctx.userId);
  }
}

/** The card's stored edits, or none when they no longer parse. */
export function storedEdits(card: CoachWriteCard): WriteCardEdits {
  const parsed = WRITE_CARD_EDITS_SCHEMAS[card.kind].safeParse(card.edits);
  return parsed.success ? parsed.data : {};
}

/**
 * Parses the app's edits with the kind's STRICT schema (anything carrying
 * numbers, titles or ids of its own is refused), then runs the kind's save.
 */
export async function performWriteCardSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string; tz: string; now: Date; afterCommit?: AfterCommit },
): Promise<CoachWriteCardSavedRefs> {
  const parsed = WRITE_CARD_EDITS_SCHEMAS[card.kind].safeParse(rawEdits ?? {});
  if (!parsed.success) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  switch (card.kind) {
    case "food":
      return performFoodSave(tx, card, parsed.data, {
        userId: ctx.userId,
        tz: ctx.tz,
        now: ctx.now,
      });
    case "grocery":
      return performGrocerySave(tx, card, parsed.data, ctx);
    case "plan":
      return performPlanSave(tx, card, parsed.data, {
        userId: ctx.userId,
        afterCommit: ctx.afterCommit,
      });
    case "pantry":
      return performPantrySave(tx, card, parsed.data, {
        userId: ctx.userId,
        now: ctx.now,
      });
    case "goals":
      return performGoalsSave(tx, card, parsed.data, { userId: ctx.userId });
    case "allergy":
      return performAllergySave(tx, card, parsed.data, {
        userId: ctx.userId,
        afterCommit: ctx.afterCommit,
      });
    case "reminders":
      return performRemindersSave(tx, card, parsed.data, {
        userId: ctx.userId,
      });
  }
}

export async function revertWriteCardSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  afterCommit?: AfterCommit,
): Promise<void> {
  switch (card.kind) {
    case "food":
      return revertFoodSave(tx, card);
    case "grocery":
      return revertGrocerySave(tx, card);
    case "plan":
      return revertPlanSave(tx, card, afterCommit);
    case "pantry":
      return revertPantrySave(tx, card);
    case "goals":
      return revertGoalsSave(tx, card);
    case "allergy":
      return revertAllergySave(tx, card, afterCommit);
    case "reminders":
      return revertRemindersSave(tx, card);
  }
}

/** Work that must wait for the save to commit (plan covers). */
export async function afterWriteCardSave(card: CoachWriteCard): Promise<void> {
  if (card.kind === "plan") await startPlanImageJobs(card);
}

export function writeCardReceiptFor(card: CoachWriteCard): string {
  const edits = storedEdits(card);
  if (card.kind === "grocery") {
    return groceryReceipt(card, edits as GroceryCardEdits);
  }
  if (card.kind === "pantry") {
    return pantryReceipt(card, edits as PantryCardEdits);
  }
  if (card.kind === "plan") {
    return planReceipt(card, edits as PlanCardEdits);
  }
  const payload = readCardPayload(card, card.kind);
  if (!payload) return STALE_CARD_RECEIPT;
  return writeCardReceipt(card.kind, payload, edits);
}

/** The tool that remakes each kind's card. The allergy card has none: the
 *  server builds it from the Coach's add_allergy action card. */
const TOOL_FOR_KIND: Record<Exclude<WriteCardKind, "allergy">, string> = {
  food: "log_food_item",
  grocery: "add_to_grocery_list",
  plan: "add_to_meal_plan",
  pantry: "update_pantry",
  goals: "set_nutrition_goals",
  reminders: "set_reminders",
};

const fmt = (n: number) => String(Math.round(n));

function describeFood(p: FoodCardPayload, e: FoodCardEdits): string {
  const counts = foodCounts(p, e);
  const items = p.items
    .map(
      (it, i) =>
        `${counts[i]} × ${it.name} (${fmt(it.perUnit.calories)} cal each)`,
    )
    .join(", ");
  return `${items}; ${mealLabel(e.mealType ?? p.mealType)}; ${e.day ?? p.day}`;
}

function describeGrocery(p: GroceryCardPayload, e: GroceryCardEdits): string {
  const kept = new Set(groceryKept(p, e));
  const items = p.items
    .map((it) => {
      const amount = [it.quantity, it.unit].filter(Boolean).join(" ");
      return `${it.name}${amount ? ` (${amount})` : ""} — ${kept.has(it) ? "ticked" : "unticked"}`;
    })
    .join("; ");
  const choice = e.listId ?? p.defaultListId ?? "new";
  const list =
    choice === "new"
      ? `a new list "${p.newListName}"`
      : (p.lists.find((l) => l.id === choice)?.title ?? "a list");
  return `${items}; list: ${list}`;
}

function describePlan(p: PlanCardPayload, e: PlanCardEdits): string {
  const meals = planKept(p, e)
    .map(
      (r) =>
        `${r.plannedDate} ${r.mealType}: ${r.recipe.title} (${fmt(r.recipe.calories)} cal, ${fmt(r.recipe.protein)} g protein)`,
    )
    .join("; ");
  // A combined card (A1): the model must know the list is already handled.
  const list = planShoppingList(p, e);
  if (list === null) return meals;
  return `${meals}; shopping for these meals: ${
    planShoppingOn(p, e)
      ? `added to ${list} on save`
      : "switched off by the user"
  }`;
}

/**
 * Coach roadmap T2: the prompt line for the conversation's latest food log
 * applied at once. It is saved, so a change must go through Undo or the log,
 * never a second log_food_item call.
 */
export function describeLoggedFood(card: CoachWriteCard): string | null {
  const payload = readCardPayload(card, "food");
  if (!payload) return null;
  const body = describeFood(payload, storedEdits(card) as FoodCardEdits);
  return `Already logged in this chat, at once, with no tap: ${body}. To change it, the user taps Undo on its card (open for 5 minutes after it was logged) or edits it in their food log. Call log_food_item only for food not logged yet.`;
}

const KIND_LABEL: Record<WriteCardKind, string> = {
  food: "food",
  grocery: "grocery list",
  plan: "meal plan",
  pantry: "pantry",
  goals: "daily goals",
  allergy: "allergy",
  reminders: "reminders",
};

/**
 * The prompt line for the conversation's live card, with the user's edits
 * applied — so "make it three eggs" starts from what is on screen now. Null
 * when the stored payload no longer parses: no line beats a crashed turn.
 */
export function describeLiveCard(card: CoachWriteCard): string | null {
  const body = describeLiveCardBody(card);
  if (body === null) return null;
  const shown = `Card on screen (${KIND_LABEL[card.kind]}, not saved): ${body}.`;
  if (card.kind === "allergy") {
    return `${shown} The user picks the severity and saves it on the card.`;
  }
  return `${shown} To change it, call ${TOOL_FOR_KIND[card.kind]} again with the full updated contents.`;
}

function describeLiveCardBody(card: CoachWriteCard): string | null {
  const e = storedEdits(card);
  switch (card.kind) {
    case "food": {
      const p = readCardPayload(card, "food");
      return p && describeFood(p, e as FoodCardEdits);
    }
    case "grocery": {
      const p = readCardPayload(card, "grocery");
      return p && describeGrocery(p, e as GroceryCardEdits);
    }
    case "plan": {
      const p = readCardPayload(card, "plan");
      return p && describePlan(p, e as PlanCardEdits);
    }
    case "pantry": {
      const p = readCardPayload(card, "pantry");
      return p && describePantry(p, e as PantryCardEdits);
    }
    case "goals": {
      const p = readCardPayload(card, "goals");
      return p && describeGoals(p, e as GoalsCardEdits);
    }
    case "allergy": {
      const p = readCardPayload(card, "allergy");
      return p && describeAllergy(p, e as AllergyCardEdits);
    }
    case "reminders": {
      const p = readCardPayload(card, "reminders");
      return p && describeReminders(p, e as RemindersCardEdits);
    }
  }
}
