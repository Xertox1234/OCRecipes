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
import { sanitizeContextField } from "../lib/ai-safety";
import { AI_DAILY_CAPS, type PremiumFeatures } from "@shared/types/premium";
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
/** The pantry's quantity column is numeric(10,2). */
const MAX_AMOUNT = 99_999_999.99;
/**
 * Below this the pantry's receipt scan records the read as failed (and the
 * monthly limit does not count it). Here it means no card: a photo the
 * classifier took for a receipt but is not one reads this low.
 */
const MIN_RECEIPT_CONFIDENCE = 0.3;

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
 * Receipt text as one clean line: no control, zero-width or direction
 * characters, and cut by whole characters (never half an emoji).
 */
function cleanText(raw: string, max: number): string {
  const flat = sanitizeContextField(raw, 1000).replace(/\s+/g, " ").trim();
  return [...flat].slice(0, max).join("").trim();
}

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
    const name = cleanText(line.name, MAX_NAME);
    const unit = (line.unit && cleanText(line.unit, MAX_UNIT)) || undefined;
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
      // An amount the pantry cannot store is left off, not cut down.
      ...(food.quantity > 0 &&
        food.quantity <= MAX_AMOUNT && {
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
const RECEIPT_UNREAD_TEXT =
  "I couldn't read that as a receipt. Try again with the whole receipt flat and in good light, or tell me what you bought.";
const RECEIPT_NO_PANTRY_TEXT =
  "Adding a receipt to your pantry needs a plan with the pantry and the receipt scanner. Tell me what you bought and I can help another way.";
const RECEIPT_MONTH_CAP_TEXT =
  "You've used this month's receipt scans. Tell me what you bought and I'll add it to your pantry.";
const RECEIPT_CAP_TEXT =
  "You've reached today's receipt limit. Tell me what you bought and I'll add it to your pantry.";

function leftOutText(skipped: number): string {
  if (skipped === 0) return "";
  return ` I left out ${skipped} ${skipped === 1 ? "line" : "lines"} I couldn't add.`;
}

/** The plan features a receipt read needs, from the route's tier lookup. */
export type ReceiptFeatures = Pick<
  PremiumFeatures,
  "pantryTracking" | "receiptScanner" | "monthlyReceiptScans"
>;

/**
 * Read a receipt photo into a pantry card, under the same plan rules as the
 * pantry's receipt scan (server/routes/receipt.ts): the receipt scanner and
 * the pantry on the plan, the monthly scan limit, and the daily receipt
 * credit. Every read is recorded as a receipt scan, so the two paths share
 * one monthly total. The receipt credit is spent on top of the photo credit
 * the chat's photo route already claimed for the classification.
 */
export async function receiptPhotoReply(
  imageBase64: string,
  ctx: { userId: string; features: ReceiptFeatures },
): Promise<ReceiptPhotoReply> {
  const { userId, features } = ctx;
  if (!features.pantryTracking || !features.receiptScanner) {
    return { payload: null, text: RECEIPT_NO_PANTRY_TEXT };
  }
  // A check, not a claim, as on the pantry route: two reads at once can both
  // pass it, and the daily credit below is what bounds the spend.
  const usedThisMonth = await storage.getMonthlyReceiptScanCount(
    userId,
    new Date(),
  );
  if (usedThisMonth >= features.monthlyReceiptScans) {
    return { payload: null, text: RECEIPT_MONTH_CAP_TEXT };
  }
  const claimed = await storage.claimDailyAiCall(
    userId,
    "receiptScan",
    AI_DAILY_CAPS.receiptScan,
  );
  if (!claimed) return { payload: null, text: RECEIPT_CAP_TEXT };

  let receipt: ReceiptAnalysisResult;
  try {
    receipt = await analyzeReceiptPhotos([imageBase64]);
  } catch (err) {
    // A failed read is recorded, as on the pantry route; it does not count
    // toward the monthly limit.
    await storage.createReceiptScan({
      userId,
      itemCount: 0,
      photoCount: 1,
      status: "failed",
    });
    throw err;
  }
  const unread = receipt.overallConfidence < MIN_RECEIPT_CONFIDENCE;
  await storage.createReceiptScan({
    userId,
    itemCount: receipt.items.length,
    photoCount: 1,
    status: unread
      ? "failed"
      : receipt.isPartialExtraction
        ? "partial"
        : "completed",
  });
  if (unread) return { payload: null, text: RECEIPT_UNREAD_TEXT };

  const { changes, skipped } = receiptToPantryChanges(receipt.items);
  if (changes.length === 0) {
    return { payload: null, text: RECEIPT_NO_FOOD_TEXT };
  }
  const args = { changes };
  const { payload } = await planPantryCard(args, userId);
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
