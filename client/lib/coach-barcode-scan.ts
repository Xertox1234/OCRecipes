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

let pending: ((code: string | null) => void) | null = null;

/**
 * Wait for the scanner screen. Resolves with the code it read, or null when
 * it closed without one. Call this before opening the screen. A newer wait
 * gives up an older one.
 */
export function awaitCoachBarcode(): Promise<string | null> {
  settleCoachBarcode(null);
  return new Promise((resolve) => {
    pending = resolve;
  });
}

/**
 * The scanner's answer: a code, or null on closing. Only the first call
 * after a wait counts, so the screen can call it with null whenever it goes
 * away.
 */
export function settleCoachBarcode(code: string | null): void {
  const resolve = pending;
  pending = null;
  resolve?.(code);
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
): Promise<string | null> {
  const res = await apiRequest(
    "POST",
    `/api/chat/conversations/${conversationId}/barcode`,
    { barcode: code, ...(openingBrief && { openingBrief }) },
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
