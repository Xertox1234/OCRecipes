/**
 * A barcode scanned live from the Coach chat: the chat waits here for the
 * scanner screen to hand back the number, then sends it as a Coach turn.
 *
 * The wait lives in this module, not in navigation params: a callback is not
 * a serializable param, and only one scanner can be open at a time.
 */
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import { isValidBarcode } from "@shared/constants/classification";
import type { PhoneLabelRead } from "@/lib/coach-label-pre-read";
import { ApiError } from "@/lib/api-error";
import { labelFitsProduct } from "@shared/lib/label-fit";

/** What the scanner hands back: the code, and the label if its step read one. */
export interface CoachBarcodeScan {
  code: string;
  /** The pack's nutrition label, read on the phone in the label step. */
  label?: PhoneLabelRead;
  /**
   * A photo of the front of the pack (the optional third step), for a
   * product the barcode gives no usable name for. Only with a label.
   */
  frontUri?: string;
}

/** What the lookup started at the scanner's lock found. */
export type CoachBarcodeLookup =
  | { status: "found"; per100gCalories?: number }
  | { status: "unknown" }
  /** An outage, or no answer: the name is as unknown as for "unknown". */
  | { status: "failed" };

/**
 * Look the product up while the scanner plays its sweep, to learn whether
 * the front-of-pack step is needed. The chat's turn looks it up again on the
 * server; this read only steers the scanner. Never rejects.
 */
export async function lookupCoachBarcode(
  code: string,
): Promise<CoachBarcodeLookup> {
  try {
    const res = await apiRequest("GET", `/api/nutrition/barcode/${code}`);
    const body = (await res.json()) as { per100g?: { calories?: unknown } };
    const calories = body?.per100g?.calories;
    return typeof calories === "number"
      ? { status: "found", per100gCalories: calories }
      : { status: "found" };
  } catch (err) {
    return err instanceof ApiError && err.status === 404
      ? { status: "unknown" }
      : { status: "failed" };
  }
}

/**
 * Whether to offer the front-of-pack step: there is a label to log, and the
 * barcode gives no usable name for it (unknown, lookup failed, or the label
 * doesn't fit the product it found). Null while the lookup is still out:
 * the scanner does not wait on it.
 */
export function needsFrontOfPack(
  lookup: CoachBarcodeLookup | null,
  label: PhoneLabelRead | undefined,
): boolean {
  if (!label || !lookup) return false;
  if (lookup.status !== "found") return true;
  return !labelFitsProduct(label, lookup.per100gCalories);
}

let pending: ((scan: CoachBarcodeScan | null) => void) | null = null;

/**
 * Wait for the scanner screen. Resolves with what it read, or null when it
 * closed without a code. Call this before opening the screen. A newer wait
 * gives up an older one.
 */
export function awaitCoachBarcode(): Promise<CoachBarcodeScan | null> {
  settleCoachBarcode(null);
  return new Promise((resolve) => {
    pending = resolve;
  });
}

/**
 * The scanner's answer: what it read, or null on closing. Only the first
 * call after a wait counts, so the screen can call it with null whenever it
 * goes away.
 */
export function settleCoachBarcode(scan: CoachBarcodeScan | null): void {
  const resolve = pending;
  pending = null;
  resolve?.(scan);
}

/**
 * The digits of a product barcode (EAN-13, EAN-8, UPC-A, UPC-E), or null for
 * anything else the camera can decode (a QR code's link, a shipping label).
 */
export function scannedProductCode(data: string): string | null {
  const code = data.trim();
  return isValidBarcode(code) ? code : null;
}

/**
 * Send a scanned barcode into a Coach conversation. The server stores the
 * turn and the Coach's reply (a food log card); the caller then refetches
 * the conversation's messages. Resolves with the reply's text for the screen
 * reader, or null when it could not be read. Rejects with the server's
 * `ApiError` when the turn was refused.
 */
export async function sendBarcodeToCoach(
  code: string,
  conversationId: number,
  /** Set on the send that opens a new chat which showed the opening brief. */
  openingBrief?: "full" | "short",
  /** The pack's label, read in the scanner's label step: the card's numbers. */
  label?: PhoneLabelRead,
): Promise<string | null> {
  const res = await apiRequest(
    "POST",
    `/api/chat/conversations/${conversationId}/barcode`,
    {
      barcode: code,
      ...(label && { label }),
      ...(openingBrief && { openingBrief }),
    },
    // The card's meal (breakfast, lunch…) is set from the user's clock.
    { headers: { "X-Timezone": getDeviceTimezone() } },
  );
  return coachTurnReplyText(res);
}

/**
 * The Coach's stored reply from a turn's answer, for the screen reader; null
 * when it cannot be read.
 */
export async function coachTurnReplyText(
  res: Response,
): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    const content = (body as { assistantMessage?: { content?: unknown } })
      ?.assistantMessage?.content;
    return typeof content === "string" && content.length > 0 ? content : null;
  } catch {
    return null;
  }
}
