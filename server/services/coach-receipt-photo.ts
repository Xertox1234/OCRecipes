/**
 * A grocery receipt photo sent into the Coach chat (Coach roadmap S3).
 *
 * The receipt is read by the same analysis as the pantry's receipt scan, and
 * the answer is the Coach's pantry card: one "add" row per food line, with
 * the line's amount and its estimated shelf life. A food the pantry already
 * holds in the same unit is topped up (planPantryCard). Nothing is written
 * until the user saves the card, and they can untick any row first.
 *
 * Every app that has the chat's photo button can draw a pantry card: the
 * card shipped (PR #1927) before the photo button (PR #1984).
 */
import { storage } from "../storage";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import type { PantryCardPayload } from "@shared/schemas/coach-write-cards";
import {
  analyzeReceiptPhotos,
  type ReceiptAnalysisResult,
} from "./receipt-analysis";
import { planPantryCard } from "./write-cards/pantry";
import { matchKey, unitKey } from "./pantry-deduction";
import {
  updatePantryCardArgsSchema,
  type UpdatePantryCardArgs,
} from "./write-cards/tool-args";

/** The pantry card's own limits (updatePantryCardArgsSchema). */
const MAX_ROWS = 20;
const MAX_NAME = 200;
const MAX_UNIT = 40;
const MAX_SHELF_LIFE_DAYS = 365;

type ReceiptLine = ReceiptAnalysisResult["items"][number];
type PantryAdd = Extract<
  UpdatePantryCardArgs["changes"][number],
  { action: "add" }
>;

/**
 * The rule the Coach's own `update_pantry` adds pass: bounded text that
 * clears the unsafe-advice screen. A receipt line is model output too (text
 * read from a picture), so it gets the same check.
 */
const changeSchema = updatePantryCardArgsSchema.shape.changes.element;

/**
 * One pantry add per food on the receipt. A food printed on two lines in the
 * same unit becomes one row with the amounts added up. `skipped` counts the
 * lines left out: one the card's rules refuse, or past 20 rows.
 */
export function receiptToPantryChanges(lines: ReceiptLine[]): {
  changes: PantryAdd[];
  skipped: number;
} {
  const merged = new Map<
    string,
    { name: string; unit?: string; quantity: number; days: number }
  >();
  let skipped = 0;
  for (const line of lines) {
    const name = line.name.trim().slice(0, MAX_NAME);
    const unit = line.unit?.trim().slice(0, MAX_UNIT) || undefined;
    if (!name) {
      skipped += 1;
      continue;
    }
    const key = `${matchKey(name)}|${unitKey(unit)}`;
    const quantity = line.quantity > 0 ? line.quantity : 0;
    const days = Math.min(
      MAX_SHELF_LIFE_DAYS,
      Math.max(1, Math.round(line.estimatedShelfLifeDays)),
    );
    const seen = merged.get(key);
    if (seen) {
      seen.quantity += quantity;
      // Two lines of one food: the row keeps the sooner date.
      seen.days = Math.min(seen.days, days);
      continue;
    }
    merged.set(key, { name, unit, quantity, days });
  }

  const changes: PantryAdd[] = [];
  for (const food of merged.values()) {
    if (changes.length === MAX_ROWS) {
      skipped += 1;
      continue;
    }
    const change = {
      action: "add" as const,
      name: food.name,
      ...(food.quantity > 0 && {
        quantity: String(Math.round(food.quantity * 100) / 100),
      }),
      ...(food.unit && { unit: food.unit }),
      expiresInDays: food.days,
    };
    const parsed = changeSchema.safeParse(change);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    changes.push(change);
  }
  return { changes, skipped };
}

/** A receipt reply: no food card, a pantry card when one survives, and the Coach's line. */
export interface ReceiptPhotoReply {
  payload: null;
  pantry?: { args: UpdatePantryCardArgs; payload: PantryCardPayload };
  text: string;
}

// Fixed wording: item names are model output read from a photo, so they stay
// on the card and out of the saved message text later turns feed the model.
export const RECEIPT_TEXT =
  "Here's what I read from your receipt. Untick anything you don't want, then add the rest to your pantry.";
const RECEIPT_CUT_OFF_TEXT =
  " Part of the receipt was cut off or hard to read, so some items may be missing.";
const RECEIPT_NO_FOOD_TEXT =
  "I couldn't find any food on that receipt. Try again with the whole receipt flat and in good light.";
const RECEIPT_NO_PANTRY_TEXT =
  "Adding a receipt to your pantry needs a plan with the pantry. Tell me what you bought and I can help another way.";
const RECEIPT_CAP_TEXT =
  "You've reached today's receipt limit. Tell me what you bought and I'll add it to your pantry.";

function leftOutText(skipped: number): string {
  if (skipped === 0) return "";
  return ` I left out ${skipped} ${skipped === 1 ? "line" : "lines"} I couldn't add.`;
}

/**
 * Read a receipt photo into a pantry card. The receipt read is the pantry
 * scan's own heavy call, so it spends a receipt credit (the same daily cap as
 * the pantry's receipt scan) on top of the photo credit the chat's photo
 * route already claimed for the classification.
 */
export async function receiptPhotoReply(
  imageBase64: string,
  ctx: { userId: string; pantryTracking: boolean },
): Promise<ReceiptPhotoReply> {
  if (!ctx.pantryTracking) {
    return { payload: null, text: RECEIPT_NO_PANTRY_TEXT };
  }
  const claimed = await storage.claimDailyAiCall(
    ctx.userId,
    "receiptScan",
    AI_DAILY_CAPS.receiptScan,
  );
  if (!claimed) return { payload: null, text: RECEIPT_CAP_TEXT };

  const receipt = await analyzeReceiptPhotos([imageBase64]);
  const { changes, skipped } = receiptToPantryChanges(receipt.items);
  if (changes.length === 0) {
    return { payload: null, text: RECEIPT_NO_FOOD_TEXT };
  }
  const args = { changes };
  const { payload } = await planPantryCard(args, ctx.userId);
  if (!payload) return { payload: null, text: RECEIPT_NO_FOOD_TEXT };
  return {
    payload: null,
    pantry: { args, payload },
    text:
      RECEIPT_TEXT +
      leftOutText(skipped) +
      (receipt.isPartialExtraction ? RECEIPT_CUT_OFF_TEXT : ""),
  };
}
