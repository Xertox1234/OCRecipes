import { categorizeIngredient } from "@shared/lib/grocery-categories";
import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  groceryEditsSchema,
  type GroceryCardEdits,
  type GroceryCardPayload,
} from "@shared/schemas/coach-write-cards";
import {
  groceryKept,
  writeCardReceipt,
} from "@shared/lib/coach-write-card-math";
import {
  insertGroceryListItemsUnderCap,
  createGroceryListWithLimitCheck,
  deleteGroceryList,
  deleteGroceryListItem,
  getGroceryLists,
  getUncheckedGroceryListItems,
  verifyGroceryListOwnership,
} from "../../storage/grocery-lists";
import { getPantryItems } from "../../storage/pantry";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import {
  normalizeIngredientName,
  parseQuantityForSum,
} from "../grocery-generation";
import { addCivilDays, civilDateString } from "../../lib/civil-date";
import {
  groupPantryByKey,
  matchKey,
  pantryVerdict,
  unitKey,
} from "../pantry-deduction";
import { WriteCardEditError } from "./errors";
import type { AddGroceryCardArgs } from "./tool-args";

export { addGroceryCardArgsSchema, type AddGroceryCardArgs } from "./tool-args";
export { matchKey, unitKey };

/**
 * Grocery write card (spec 2026-11-09): a checklist Coach builds for a dish or
 * a week. Items the pantry clearly covers are left off; items Coach only suspects
 * the user has start unticked. Saving adds the ticked items to one of the
 * user's lists, or to a new one.
 */

export const LISTS_OFFERED = 4;
const DEFAULT_NEW_LIST_NAME = "Coach list";
/** Same cap the generate-list route applies (server/routes/grocery.ts). */
export const MAX_GROCERY_LISTS = 50;

export interface GroceryCardPlan {
  /** Null when the pantry covers every item: there is no card to show. */
  payload: GroceryCardPayload | null;
  /** The model's own names for the items left off the card. */
  leftOff: string[];
  /** Items kept but unticked because the pantry may already cover them. */
  unticked: string[];
}

/**
 * Works out the card and what the pantry changed on it, so the tool call can
 * tell the model before it writes its reply.
 */
export async function planGroceryCard(
  args: AddGroceryCardArgs,
  userId: string,
  now: Date = new Date(),
): Promise<GroceryCardPlan> {
  const [pantry, lists] = await Promise.all([
    getPantryItems(userId),
    getGroceryLists(userId, LISTS_OFFERED),
  ]);
  const byKey = groupPantryByKey(pantry, now);

  const items: GroceryCardPayload["items"] = [];
  const leftOff: string[] = [];
  const unticked: string[] = [];
  for (const i of args.items) {
    const verdict = pantryVerdict(i, byKey.get(matchKey(i.name)) ?? []);
    if (verdict === "covered") {
      leftOff.push(i.name);
      continue;
    }
    if (verdict === "unsure") unticked.push(i.name);
    items.push({
      name: i.name,
      quantity: i.quantity ?? null,
      unit: i.unit ?? null,
      ticked: !i.maybeHave && verdict !== "unsure",
    });
  }
  if (items.length === 0) return { payload: null, leftOff, unticked };
  return {
    payload: {
      items,
      lists: lists.map((l) => ({ id: l.id, title: l.title })),
      defaultListId: lists[0]?.id ?? null,
      newListName: args.listName ?? DEFAULT_NEW_LIST_NAME,
    },
    leftOff,
    unticked,
  };
}

export async function buildGroceryPayload(
  args: AddGroceryCardArgs,
  userId: string,
): Promise<GroceryCardPayload> {
  const { payload } = await planGroceryCard(args, userId);
  if (!payload) {
    throw new WriteCardEditError("Everything is already in the pantry.");
  }
  return payload;
}

function parseGroceryEdits(
  p: GroceryCardPayload,
  raw: unknown,
): GroceryCardEdits {
  const parsed = groceryEditsSchema.safeParse(raw ?? {});
  if (
    !parsed.success ||
    (parsed.data.ticked && parsed.data.ticked.length !== p.items.length)
  ) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  return parsed.data;
}

/** grocery_list_items.quantity is numeric(10,2), as in the pantry card. */
const MAX_QUANTITY = 99_999_999.99;

function toRow(item: GroceryCardPayload["items"][number]) {
  const qty = parseQuantityForSum(item.quantity);
  return {
    name: item.name,
    // Too large to store: keep the line, drop the amount, rather than failing
    // the whole save (reliability audit 2026-11-19, L-xc-5).
    quantity: qty === null || qty > MAX_QUANTITY ? null : String(qty),
    unit: item.unit,
    category: categorizeIngredient(item.name),
  };
}

/** Same item, unit and amount: the line a repeated save would duplicate. */
export function lineKey(row: {
  name: string;
  quantity: string | null;
  unit: string | null;
}): string {
  const qty = parseQuantityForSum(row.quantity);
  return `${matchKey(row.name)}|${unitKey(row.unit)}|${qty ?? ""}`;
}

export async function performGrocerySave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string; tz: string; now: Date },
): Promise<CoachWriteCardSavedRefs> {
  const payload = card.payload as GroceryCardPayload;
  const edits = parseGroceryEdits(payload, rawEdits);
  const kept = groceryKept(payload, edits);
  if (kept.length === 0) throw new WriteCardEditError("Nothing to add.");

  const choice = edits.listId ?? payload.defaultListId ?? "new";
  if (choice === "new") {
    const created = await createGroceryListWithLimitCheck(
      {
        userId: ctx.userId,
        title: payload.newListName,
        dateRangeStart: civilDateString(ctx.now, ctx.tz),
        // Calendar days, not 6 × 24 h, which ends a day early across a DST change.
        dateRangeEnd: addCivilDays(civilDateString(ctx.now, ctx.tz), 6),
      },
      kept.map(toRow),
      MAX_GROCERY_LISTS,
      tx,
    );
    if (!created) {
      throw new WriteCardEditError("You have too many grocery lists.");
    }
    return {
      createdListId: created.list.id,
      listId: created.list.id,
      groceryItemIds: created.items.map((i) => i.id),
      ...(created.skipped > 0 && { groceryListFull: created.skipped }),
    };
  }

  // Only a list the card offered, and only if it is still the user's.
  if (
    !payload.lists.some((l) => l.id === choice) ||
    !(await verifyGroceryListOwnership(choice, ctx.userId))
  ) {
    throw new WriteCardEditError("That list isn't available.");
  }
  // An item still waiting on the list, with the same amount, is not added
  // again (asking Coach twice used to double the list). A bought (checked)
  // item or a different amount is a new line. Skipped, never merged: undo
  // deletes by the ids this save added.
  const waiting = new Set(
    (await getUncheckedGroceryListItems(choice, ctx.userId, tx)).map(lineKey),
  );
  const { created, skipped } = await insertGroceryListItemsUnderCap(
    choice,
    ctx.userId,
    kept.map(toRow).filter((row) => !waiting.has(lineKey(row))),
    tx,
  );
  return {
    listId: choice,
    groceryItemIds: created.map((r) => r.id),
    ...(skipped > 0 && { groceryListFull: skipped }),
  };
}

export async function revertGrocerySave(
  tx: WriteCardTx,
  card: CoachWriteCard,
): Promise<void> {
  const refs = card.savedRefs;
  if (!refs?.listId) return;
  if (refs.createdListId) {
    // Items cascade with the list this save created.
    await deleteGroceryList(refs.createdListId, card.userId, tx);
    return;
  }
  for (const id of refs.groceryItemIds ?? []) {
    await deleteGroceryListItem(id, refs.listId, card.userId, tx);
  }
}

function groceryReceiptListTitle(card: CoachWriteCard): string | undefined {
  const payload = card.payload as GroceryCardPayload;
  const refs = card.savedRefs;
  if (!refs?.listId) return undefined;
  if (refs.createdListId) return payload.newListName;
  return payload.lists.find((l) => l.id === refs.listId)?.title;
}

/**
 * The saved card's one line. It counts what the save really added, which is
 * fewer than the ticked items when some were already waiting on the list.
 */
export function groceryReceipt(
  card: CoachWriteCard,
  edits: GroceryCardEdits = {},
): string {
  const payload = card.payload as GroceryCardPayload;
  const listTitle = groceryReceiptListTitle(card);
  const kept = groceryKept(payload, edits).length;
  const added = card.savedRefs?.groceryItemIds?.length ?? kept;
  const full = card.savedRefs?.groceryListFull ?? 0;
  const already = Math.max(0, kept - added - full);
  const base = writeCardReceipt("grocery", payload, edits, listTitle);
  if (added >= kept) return base;
  const fullNote = full > 0 ? `${full} didn't fit (list full)` : "";
  if (added === 0) {
    if (already === 0) return `✓ ${listTitle ?? "Your list"} is full`;
    return `✓ Already on ${listTitle ?? "your list"}${fullNote && ` · ${fullNote}`}`;
  }
  const to = listTitle ? ` to ${listTitle}` : "";
  const notes = [already > 0 && `${already} already there`, fullNote]
    .filter(Boolean)
    .join(" · ");
  return `✓ Added ${added} ${added === 1 ? "item" : "items"}${to} · ${notes}`;
}
