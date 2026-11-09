import { z } from "zod";
import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  groceryEditsSchema,
  type GroceryCardEdits,
  type GroceryCardPayload,
} from "@shared/schemas/coach-write-cards";
import { groceryKept } from "@shared/lib/coach-write-card-math";
import {
  addGroceryListItems,
  createGroceryListWithLimitCheck,
  deleteGroceryList,
  deleteGroceryListItem,
  getGroceryLists,
  verifyGroceryListOwnership,
} from "../../storage/grocery-lists";
import { getPantryItems } from "../../storage/pantry";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import {
  categorizeIngredient,
  normalizeIngredientName,
  parseQuantityForSum,
} from "../grocery-generation";
import { civilDateString } from "../../lib/civil-date";
import { WriteCardEditError } from "./errors";

/**
 * Grocery write card (spec 2026-11-09): a checklist Coach builds for a dish or
 * a week. Items already in the pantry are left off; items Coach only suspects
 * the user has start unticked. Saving adds the ticked items to one of the
 * user's lists, or to a new one.
 */

export const addGroceryCardArgsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.string().trim().max(40).optional(),
        unit: z.string().trim().max(40).optional(),
        maybeHave: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(40),
  listName: z.string().trim().min(1).max(100).optional(),
});
export type AddGroceryCardArgs = z.infer<typeof addGroceryCardArgsSchema>;

const LISTS_OFFERED = 4;
const DEFAULT_NEW_LIST_NAME = "Coach list";
/** Same cap the generate-list route applies (server/routes/grocery.ts). */
const MAX_GROCERY_LISTS = 50;

/** Pantry match key: normalized, with a plural "s"/"es" dropped. */
function matchKey(name: string): string {
  return normalizeIngredientName(name).replace(/(es|s)$/, "");
}

export async function buildGroceryPayload(
  args: AddGroceryCardArgs,
  userId: string,
): Promise<GroceryCardPayload> {
  const [pantry, lists] = await Promise.all([
    getPantryItems(userId),
    getGroceryLists(userId, LISTS_OFFERED),
  ]);
  const inPantry = new Set(pantry.map((p) => matchKey(p.name)));
  const items = args.items
    .filter((i) => !inPantry.has(matchKey(i.name)))
    .map((i) => ({
      name: i.name,
      quantity: i.quantity ?? null,
      unit: i.unit ?? null,
      ticked: !i.maybeHave,
    }));
  if (items.length === 0) {
    throw new WriteCardEditError("Everything is already in the pantry.");
  }
  return {
    items,
    lists: lists.map((l) => ({ id: l.id, title: l.title })),
    defaultListId: lists[0]?.id ?? null,
    newListName: args.listName ?? DEFAULT_NEW_LIST_NAME,
  };
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

function toRow(item: GroceryCardPayload["items"][number]) {
  const qty = parseQuantityForSum(item.quantity);
  return {
    name: item.name,
    quantity: qty === null ? null : String(qty),
    unit: item.unit,
    category: categorizeIngredient(item.name),
  };
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
        dateRangeEnd: civilDateString(
          new Date(ctx.now.getTime() + 6 * 24 * 60 * 60 * 1000),
          ctx.tz,
        ),
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
    };
  }

  // Only a list the card offered, and only if it is still the user's.
  if (
    !payload.lists.some((l) => l.id === choice) ||
    !(await verifyGroceryListOwnership(choice, ctx.userId))
  ) {
    throw new WriteCardEditError("That list isn't available.");
  }
  const rows = await addGroceryListItems(
    kept.map((i) => ({ ...toRow(i), groceryListId: choice })),
    tx,
  );
  return { listId: choice, groceryItemIds: rows.map((r) => r.id) };
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

/** The receipt names the list the items went to. */
export function groceryReceiptListTitle(
  card: CoachWriteCard,
): string | undefined {
  const payload = card.payload as GroceryCardPayload;
  const refs = card.savedRefs;
  if (!refs?.listId) return undefined;
  if (refs.createdListId) return payload.newListName;
  return payload.lists.find((l) => l.id === refs.listId)?.title;
}
