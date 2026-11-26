/**
 * Reading a nutrition label on the phone before a Coach chat photo is sent
 * (Coach roadmap V5).
 *
 * The phone's own text reader (ML Kit, the one the Scan screen uses) reads
 * the photo. When the text is plainly a nutrition panel with calories,
 * protein, carbs, fat and a serving in grams or millilitres all read off the
 * print, the chat sends those numbers instead of the photo: no upload, no
 * vision model, no photo credit, and the photo never leaves the phone.
 * Anything less certain (any other photo, a panel the reader half-read, a
 * build without the reader) gives null, and the photo is sent as before.
 *
 * The bar is higher than the Scan screen's instant preview, which the server
 * read replaces: here the phone's read is the answer. The user still checks
 * the numbers on the food card before anything is logged.
 */
import type { LocalOCRResult } from "@/camera/types";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import { coachTurnReplyText } from "@/lib/coach-barcode-scan";
import { parseLabelServingGrams } from "@shared/lib/label-serving";
import {
  parseNutritionFromOCR,
  type NumericField,
} from "./nutrition-ocr-parser";

/** What the chat sends for a label read on the phone. */
export interface PhoneLabelRead {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSize: string;
}

/**
 * The panel's heading: US and Canadian labels print it above the numbers. A
 * menu or a receipt can list calories and protein, but never this.
 */
const PANEL_HEADING = /nutrition\s*facts|valeur\s*nutritive/i;

/** The four numbers the food card carries, each read off the print. */
const NEEDED: NumericField[] = [
  "calories",
  "protein",
  "totalCarbs",
  "totalFat",
];

/** The label's numbers when the text is plainly a nutrition panel, else null. */
export function labelFromOCRText(text: string): PhoneLabelRead | null {
  if (!PANEL_HEADING.test(text)) return null;
  const parsed = parseNutritionFromOCR(text);
  // A direct read only: a value whose unit was misread, or one inferred from
  // a neighbouring line, could be out by a factor of ten.
  if (!NEEDED.every((f) => parsed.directReads.includes(f))) return null;
  const { calories, protein, totalCarbs, totalFat, servingSize } = parsed;
  if (
    calories === null ||
    protein === null ||
    totalCarbs === null ||
    totalFat === null ||
    servingSize === null ||
    // Per what: a serving with no gram or millilitre amount ("1 can") does
    // not say.
    parseLabelServingGrams(servingSize) === null
  ) {
    return null;
  }
  if (!fitsFoodCard(calories, protein, totalCarbs, totalFat)) return null;
  if (!addsUp(calories, protein, totalCarbs, totalFat)) return null;
  return {
    calories,
    protein,
    carbs: totalCarbs,
    fat: totalFat,
    servingSize,
  };
}

/**
 * The food card's own limits (logFoodCardArgsSchema's estimate). A read
 * past them would be refused on every resend of the same photo.
 */
function fitsFoodCard(
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
) {
  return kcal <= 5000 && protein <= 500 && carbs <= 1000 && fat <= 500;
}

/**
 * The calories agree with the macros (4 kcal a gram of protein or carbs, 9 of
 * fat). A direct read can still have a digit misread or dropped ("230" read
 * as "20"); this catches it. The band is wide, because fibre, sugar alcohols
 * and the label's own rounding make real panels drift.
 */
function addsUp(kcal: number, protein: number, carbs: number, fat: number) {
  const fromMacros = 4 * protein + 4 * carbs + 9 * fat;
  return Math.abs(fromMacros - kcal) <= Math.max(30, 0.25 * kcal);
}

/**
 * How long the phone's reader may take. It is only a shortcut: past this the
 * photo uploads as before, rather than a native call that never settles
 * holding the chat's photo button.
 */
const READ_DEADLINE_MS = 4000;

/**
 * Read the photo's text on the phone and check it. Null when the photo is
 * not a clear label, or the phone could not read it in time; never rejects.
 */
export async function preReadLabel(
  uri: string,
  recognize: (uri: string) => Promise<LocalOCRResult>,
): Promise<PhoneLabelRead | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READ_DEADLINE_MS);
  });
  const read = recognize(uri).then(
    ({ text }) => (text ? labelFromOCRText(text) : null),
    // No reader in this build, or it failed on this photo: send the photo.
    () => null,
  );
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a label read on the phone into a Coach conversation: the numbers
 * only, never the photo. The server stores the turn and the Coach's reply (a
 * food log card). Resolves with the reply's text for the screen reader, or
 * null when it could not be read. Rejects with the server's `ApiError` when
 * the turn was refused.
 */
export async function sendLabelToCoach(
  read: PhoneLabelRead,
  conversationId: number,
  /** Set on the send that opens a new chat which showed the opening brief. */
  openingBrief?: "full" | "short",
): Promise<string | null> {
  const res = await apiRequest(
    "POST",
    `/api/chat/conversations/${conversationId}/label`,
    { label: read, ...(openingBrief && { openingBrief }) },
    // The card's meal (breakfast, lunch…) is set from the user's clock.
    { headers: { "X-Timezone": getDeviceTimezone() } },
  );
  return coachTurnReplyText(res);
}
