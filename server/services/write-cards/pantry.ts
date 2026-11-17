import type {
  CoachWriteCard,
  CoachWriteCardSavedRefs,
  InsertPantryItem,
  PantryItem,
  PantryRowCopy,
} from "@shared/schema";
import {
  pantryEditsSchema,
  type PantryCardEdits,
  type PantryCardPayload,
} from "@shared/schemas/coach-write-cards";
import {
  PANTRY_ACTION_LABEL,
  pantryKept,
  pantryRowAmount,
  writeCardReceipt,
} from "@shared/lib/coach-write-card-math";
import {
  MAX_PANTRY_ITEMS,
  deletePantryItemInTx,
  getPantryItemForUpdate,
  getPantryItems,
  insertPantryItemsUnderCap,
  lockPantryAndGetRoom,
  restorePantryItemsUnderCap,
  setPantryItemQuantityInTx,
} from "../../storage/pantry";
import { getEffectiveTierForUser } from "../../storage/subscription-status";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import { TIER_FEATURES } from "@shared/types/premium";
import {
  categorizeIngredient,
  parseQuantityForSum,
  roundQuantity,
} from "../grocery-generation";
import { WriteCardEditError } from "./errors";
import { matchKey, unitKey } from "./grocery";
import type { UpdatePantryCardArgs } from "./tool-args";

export {
  updatePantryCardArgsSchema,
  type UpdatePantryCardArgs,
} from "./tool-args";

/**
 * Pantry write card (spec 2026-11-16): the changes Coach proposes to the
 * pantry, one row each. Nothing is written until the user saves the card, a
 * row that changed since the card was built is skipped, and Undo puts back
 * what the save changed.
 */

type Row = PantryCardPayload["rows"][number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** The pantry's quantity column is numeric(10,2); the pantry routes cap at this too. */
const MAX_AMOUNT = 99_999_999.99;

/** A model-written amount as a number, or null when unknown or too large to store. */
function amountOf(raw: string | null | undefined): number | null {
  const n = parseQuantityForSum(raw);
  return n === null || n > MAX_AMOUNT ? null : n;
}

/** The same amount, compared as numbers ("2.00" is "2"); null only equals null. */
function sameAmount(a: string | null, b: string | null): boolean {
  const x = parseQuantityForSum(a);
  const y = parseQuantityForSum(b);
  if (x === null || y === null) return x === y;
  return roundQuantity(x) === roundQuantity(y);
}

export interface PantryCardPlan {
  /** Null when no change survives: there is no card to show. */
  payload: PantryCardPayload | null;
  /**
   * Changes left off: a row that is not the user's, one named twice, or a use
   * whose amount could not be read.
   */
  dropped: number;
}

/**
 * Works out the card during the tool call, so the tool result can tell the
 * model what the card shows.
 */
export async function planPantryCard(
  args: UpdatePantryCardArgs,
  userId: string,
): Promise<PantryCardPlan> {
  const pantry = await getPantryItems(userId, MAX_PANTRY_ITEMS);
  const byId = new Map(pantry.map((p) => [p.id, p]));
  const touched = new Set<number>();
  const rows: Row[] = [];
  let dropped = 0;

  for (const change of args.changes) {
    if (change.action === "add") {
      const amount = amountOf(change.quantity);
      // A top-up needs amounts on both sides and the same unit, and a sum the
      // column can hold; anything else is its own new row.
      const match =
        amount === null
          ? undefined
          : pantry.find(
              (p) =>
                !touched.has(p.id) &&
                matchKey(p.name) === matchKey(change.name) &&
                unitKey(p.unit) === unitKey(change.unit) &&
                (parseQuantityForSum(p.quantity) ?? Infinity) + amount <=
                  MAX_AMOUNT,
            );
      if (match) touched.add(match.id);
      rows.push({
        action: "add",
        name: (match?.name ?? change.name).slice(0, 200),
        quantity: amount === null ? null : String(amount),
        unit: match ? match.unit : (change.unit ?? null),
        itemId: match?.id ?? null,
        held: match?.quantity ?? null,
        all: false,
        expiresInDays: match ? null : (change.expiresInDays ?? null),
      });
      continue;
    }

    const row = byId.get(change.itemId);
    if (!row || touched.has(row.id)) {
      dropped += 1;
      continue;
    }
    touched.add(row.id);
    const base = {
      name: row.name.slice(0, 200),
      unit: row.unit,
      itemId: row.id,
      held: row.quantity,
      expiresInDays: null,
    };
    if (change.action === "remove") {
      rows.push({ ...base, action: "remove", quantity: null, all: false });
      continue;
    }
    const held = parseQuantityForSum(row.quantity);
    // Read with no storage cap: a use amount is never stored, only compared.
    const amount = parseQuantityForSum(change.quantity);
    // An amount that cannot be read ("half", "-1") is dropped, never guessed
    // as "use all": emptying a row the user did not ask to empty is the
    // costly mistake.
    if (change.all !== true && amount === null) {
      touched.delete(row.id);
      dropped += 1;
      continue;
    }
    // Using more than the row holds, or from a row with no amount, uses it up.
    const all =
      change.all === true || held === null || amount === null || amount >= held;
    rows.push({
      ...base,
      action: "use",
      quantity: all ? null : String(amount),
      all,
    });
  }

  if (rows.length === 0) return { payload: null, dropped };
  return { payload: { rows }, dropped };
}

export async function buildPantryPayload(
  args: UpdatePantryCardArgs,
  userId: string,
): Promise<PantryCardPayload> {
  const { payload } = await planPantryCard(args, userId);
  if (!payload) {
    throw new WriteCardEditError("None of those pantry items could be found.");
  }
  return payload;
}

/** One row as a short line: "Use Milk 1 L of 2 L". */
export function pantryRowLine(row: Row): string {
  return [PANTRY_ACTION_LABEL[row.action], row.name, pantryRowAmount(row)]
    .filter(Boolean)
    .join(" ");
}

function parsePantryEdits(p: PantryCardPayload, raw: unknown): PantryCardEdits {
  const parsed = pantryEditsSchema.safeParse(raw ?? {});
  if (
    !parsed.success ||
    (parsed.data.ticked && parsed.data.ticked.length !== p.rows.length)
  ) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  return parsed.data;
}

function copyOf(
  row: PantryItem,
  deleted: boolean,
  after: string | null,
): PantryRowCopy {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    category: row.category,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    deleted,
    after,
  };
}

export async function performPantrySave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string; now: Date },
): Promise<CoachWriteCardSavedRefs> {
  const payload = card.payload as PantryCardPayload;
  const kept = pantryKept(payload, parsePantryEdits(payload, rawEdits));
  if (kept.length === 0) throw new WriteCardEditError("Nothing to change.");
  // The plan is checked when the card is built, and again here: a card can
  // outlive the subscription, and the pantry screen refuses the same user.
  // Undo is not gated, so a save made in time can always be taken back.
  const tier = await getEffectiveTierForUser(ctx.userId);
  if (!TIER_FEATURES[tier].pantryTracking) {
    throw new WriteCardEditError("Your plan no longer includes the pantry.");
  }

  // A nested transaction only to reach the full transaction client the pantry
  // storage needs; the advisory lock it takes is held until the card's own
  // transaction commits. Queries run one after another on this one client.
  return tx.transaction(async (inner) => {
    await lockPantryAndGetRoom(inner, ctx.userId);
    const counts = { added: 0, used: 0, removed: 0, skipped: 0 };
    const restore: PantryRowCopy[] = [];
    const inserts: InsertPantryItem[] = [];

    for (const row of kept) {
      if (row.itemId === null) {
        inserts.push({
          userId: ctx.userId,
          name: row.name,
          quantity: row.quantity,
          unit: row.unit,
          category: categorizeIngredient(row.name),
          expiresAt: row.expiresInDays
            ? new Date(ctx.now.getTime() + row.expiresInDays * DAY_MS)
            : null,
        });
        continue;
      }
      // Read under a row lock, then compare: the pantry screen's own edits
      // do not take the advisory lock. A row that is gone, not the user's, or
      // no longer holds what the card showed is never written.
      const current = await getPantryItemForUpdate(
        inner,
        row.itemId,
        ctx.userId,
      );
      if (!current || !sameAmount(current.quantity, row.held)) {
        counts.skipped += 1;
        continue;
      }
      if (row.action === "remove" || (row.action === "use" && row.all)) {
        await deletePantryItemInTx(inner, current.id, ctx.userId);
        restore.push(copyOf(current, true, null));
        counts[row.action === "remove" ? "removed" : "used"] += 1;
        continue;
      }
      const held = parseQuantityForSum(current.quantity) ?? 0;
      const amount = parseQuantityForSum(row.quantity) ?? 0;
      const next = String(
        roundQuantity(row.action === "add" ? held + amount : held - amount),
      );
      await setPantryItemQuantityInTx(inner, current.id, ctx.userId, next);
      restore.push(copyOf(current, false, next));
      counts[row.action === "add" ? "added" : "used"] += 1;
    }

    const { created, skipped } =
      inserts.length > 0
        ? await insertPantryItemsUnderCap(inner, ctx.userId, inserts)
        : { created: [], skipped: 0 };
    counts.added += created.length;
    counts.skipped += skipped;
    return {
      pantryAddedIds: created.map((r) => r.id),
      pantryRestore: restore,
      pantryCounts: counts,
    };
  });
}

export async function revertPantrySave(
  tx: WriteCardTx,
  card: CoachWriteCard,
): Promise<void> {
  const refs = card.savedRefs;
  if (!refs?.pantryCounts) return;
  // The owner is always the card's user, never a value from the stored copy.
  const userId = card.userId;
  await tx.transaction(async (inner) => {
    await lockPantryAndGetRoom(inner, userId);
    for (const id of refs.pantryAddedIds ?? []) {
      await deletePantryItemInTx(inner, id, userId);
    }
    const reinserts: (InsertPantryItem & { id: number })[] = [];
    for (const copy of refs.pantryRestore ?? []) {
      if (copy.deleted) {
        reinserts.push({
          // The original id: the card names rows by id, and Undo makes it
          // live again, so a second save must still find them.
          id: copy.id,
          userId,
          name: copy.name,
          quantity: copy.quantity,
          unit: copy.unit,
          category: copy.category,
          // The copy is JSON: the date comes back as text.
          expiresAt: copy.expiresAt ? new Date(copy.expiresAt) : null,
        });
        continue;
      }
      // Only a row that still holds what the save wrote: a change the user
      // made since is theirs to keep.
      const current = await getPantryItemForUpdate(inner, copy.id, userId);
      if (current && sameAmount(current.quantity, copy.after)) {
        await setPantryItemQuantityInTx(inner, copy.id, userId, copy.quantity);
      }
    }
    // The user may have added items since the save: what no longer fits
    // under the cap is left out.
    if (reinserts.length > 0) {
      await restorePantryItemsUnderCap(inner, userId, reinserts);
    }
  });
}

/** The saved card's one line: what the save really changed. */
export function pantryReceipt(
  card: CoachWriteCard,
  edits: PantryCardEdits = {},
): string {
  const counts = card.savedRefs?.pantryCounts;
  if (!counts) {
    return writeCardReceipt("pantry", card.payload as PantryCardPayload, edits);
  }
  const done = [
    counts.added > 0 && `${counts.added} added`,
    counts.used > 0 && `${counts.used} used`,
    counts.removed > 0 && `${counts.removed} removed`,
  ].filter(Boolean);
  const skipped = counts.skipped > 0 ? ` · ${counts.skipped} skipped` : "";
  return done.length === 0
    ? `✓ Nothing changed${skipped}`
    : `✓ Pantry updated · ${done.join(", ")}${skipped}`;
}

/** The card on screen, for the prompt (the caller sanitizes the whole line). */
export function describePantry(
  p: PantryCardPayload,
  e: PantryCardEdits,
): string {
  const kept = new Set(pantryKept(p, e));
  return p.rows
    .map(
      (row) =>
        `${pantryRowLine(row)} — ${kept.has(row) ? "ticked" : "unticked"}`,
    )
    .join("; ");
}
