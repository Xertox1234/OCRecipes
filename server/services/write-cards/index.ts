import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  WRITE_CARD_EDITS_SCHEMAS,
  type FoodCardEdits,
  type FoodCardPayload,
  type GroceryCardEdits,
  type GroceryCardPayload,
  type PlanCardEdits,
  type PlanCardPayload,
  type WriteCardEdits,
  type WriteCardKind,
  type WriteCardPayload,
} from "@shared/schemas/coach-write-cards";
import {
  foodCounts,
  groceryKept,
  mealLabel,
  planKept,
  writeCardReceipt,
} from "@shared/lib/coach-write-card-math";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import type { AfterCommit } from "../../storage/meal-plan-recipes-crud";
import { buildFoodPayload, performFoodSave, revertFoodSave } from "./food";
import {
  buildGroceryPayload,
  groceryReceiptListTitle,
  performGrocerySave,
  revertGrocerySave,
} from "./grocery";
import {
  buildPlanPayload,
  performPlanSave,
  revertPlanSave,
  startPlanImageJobs,
} from "./plan";
import { WriteCardEditError } from "./errors";
import type { WriteCardProposal } from "./tool-args";

export { WriteCardEditError };

export type { WriteCardProposal } from "./tool-args";

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
      return buildPlanPayload(p.args, ctx.userId);
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
        now: ctx.now,
      });
    case "grocery":
      return performGrocerySave(tx, card, parsed.data, ctx);
    case "plan":
      return performPlanSave(tx, card, parsed.data, {
        userId: ctx.userId,
        afterCommit: ctx.afterCommit,
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
  }
}

/** Work that must wait for the save to commit (plan covers). */
export async function afterWriteCardSave(card: CoachWriteCard): Promise<void> {
  if (card.kind === "plan") await startPlanImageJobs(card);
}

export function writeCardReceiptFor(card: CoachWriteCard): string {
  return writeCardReceipt(
    card.kind,
    card.payload as WriteCardPayload,
    storedEdits(card),
    card.kind === "grocery" ? groceryReceiptListTitle(card) : undefined,
  );
}

const TOOL_FOR_KIND: Record<WriteCardKind, string> = {
  food: "log_food_item",
  grocery: "add_to_grocery_list",
  plan: "add_to_meal_plan",
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
  return planKept(p, e)
    .map(
      (r) =>
        `${r.plannedDate} ${r.mealType}: ${r.recipe.title} (${fmt(r.recipe.calories)} cal, ${fmt(r.recipe.protein)} g protein)`,
    )
    .join("; ");
}

const KIND_LABEL: Record<WriteCardKind, string> = {
  food: "food",
  grocery: "grocery list",
  plan: "meal plan",
};

/**
 * The prompt line for the conversation's live card, with the user's edits
 * applied — so "make it three eggs" starts from what is on screen now.
 */
export function describeLiveCard(card: CoachWriteCard): string {
  const e = storedEdits(card);
  let body: string;
  switch (card.kind) {
    case "food":
      body = describeFood(card.payload as FoodCardPayload, e as FoodCardEdits);
      break;
    case "grocery":
      body = describeGrocery(
        card.payload as GroceryCardPayload,
        e as GroceryCardEdits,
      );
      break;
    case "plan":
      body = describePlan(card.payload as PlanCardPayload, e as PlanCardEdits);
      break;
  }
  return `Card on screen (${KIND_LABEL[card.kind]}, not saved): ${body}. To change it, call ${TOOL_FOR_KIND[card.kind]} again with the full updated contents.`;
}
