import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";
import { mealLabel } from "@shared/lib/coach-write-card-math";
import type {
  WriteCardDay,
  WriteCardMealType,
  WriteCardStatus,
} from "@shared/schemas/coach-write-cards";

/**
 * Pure helpers for the Coach write cards (spec 2026-11-09), kept out of the
 * components so Vitest covers them.
 */

export type CardUiState =
  | "live"
  | "saving"
  | "saved"
  | "failed"
  | "replaced"
  | "expired";

const MAX_COUNT = 20;

/**
 * The card's look: the server's status wins once the card is saved or
 * locked; while it is live, a save in flight or a failed save shows.
 */
export function cardUiState(
  serverStatus: WriteCardStatus,
  local: { saving: boolean; error: string | null },
): CardUiState {
  if (serverStatus !== "live") return serverStatus;
  if (local.saving) return "saving";
  if (local.error) return "failed";
  return "live";
}

export function stepCount(count: number, delta: 1 | -1): number {
  return Math.min(MAX_COUNT, Math.max(0, count + delta));
}

export function mealChipLabel(mealType: WriteCardMealType): string {
  return mealLabel(mealType);
}

export function dayChipLabel(day: WriteCardDay): string {
  return day === "today" ? "Today" : "Yesterday";
}

const CODE_MESSAGES: Record<string, string> = {
  CARD_LOCKED: "This card was replaced by a newer one.",
  UNDO_EXPIRED: "It's too late to undo this.",
  CARD_NOT_SAVED: "This card isn't saved.",
};

/** What the card says when a save or undo fails. */
export function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code && CODE_MESSAGES[err.code]) return CODE_MESSAGES[err.code];
    // A 400 carries a message written for the user (the edit errors).
    if (err.status === 400) {
      const body = err.message.replace(/^\d+: /, "");
      try {
        const parsed: unknown = JSON.parse(body);
        const msg = (parsed as { error?: unknown }).error;
        if (typeof msg === "string" && msg.length > 0) return msg;
      } catch {
        // not JSON — fall through
      }
    }
    if (err.code === ErrorCode.RATE_LIMITED || err.status === 429) {
      return "Too many saves at once. Please wait a moment and try again.";
    }
    // The server answered, so the connection is fine (audit 2026-11-24, L54).
    return "Couldn't save. Please try again.";
  }
  return "Couldn't save. Check your connection and try again.";
}

/** iOS XXXL body text is about 1.35×; the default (Large) is 1. */
const STACK_FONT_SCALE = 1.3;

/**
 * Whether a tick row stacks its tag, name and amount under each other. Side
 * by side, the tag and amount never shrink, so at the accessibility sizes
 * they left the name one letter wide (sim check 2026-11-22).
 */
export function stackCardRow(fontScale: number): boolean {
  return fontScale >= STACK_FONT_SCALE;
}

/** "Mon, Nov 9" for a plan row's yyyy-mm-dd (noon avoids a tz day-shift). */
export function planDayLabel(plannedDate: string): string {
  return new Date(`${plannedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Chicken, Rice and 5 more": the plan card's shopping preview (A1). */
export function planShoppingPreview(names: string[], max = 8): string {
  const shown = names.slice(0, max).join(", ");
  const rest = names.length - max;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/**
 * Coach roadmap T2: Undo on a food log the Coach applied at once. It shows
 * with no Save tap, on the newest reply's card only (`isActive` is unset on
 * the reply still coming in), and goes for good when the user sends the next
 * message (`closed`), once it is undone, or once the server said it is too
 * late. No timer
 * (WCAG 2.2.1); the server keeps Undo open for 5 minutes.
 */
export function atOnceUndoShown(a: {
  loggedAtOnce: true | undefined;
  status: WriteCardStatus;
  isActive: boolean | undefined;
  replyInFlight: boolean;
  closed: boolean;
}): boolean {
  return (
    a.loggedAtOnce === true &&
    a.status === "saved" &&
    a.isActive !== false &&
    !a.replyInFlight &&
    !a.closed
  );
}

/**
 * The reminders card's words for one row (Coach roadmap A3): how the
 * reminder is now and what Save does to it, as a short caption and as the
 * switch's screen-reader hint. `proposed` is the Coach's switch: the card
 * only holds reminders that would change, so the reminder is now the other
 * way. `value` is the switch as the user left it.
 */
export function reminderRowText(
  proposed: boolean,
  value: boolean,
): { caption: string; hint: string } {
  const now = proposed ? "off" : "on";
  const Now = proposed ? "Off" : "On";
  const after = value ? "on" : "off";
  if (value === !proposed) {
    return {
      caption: `${Now} now · no change`,
      hint: `${Now} now. Saving the card leaves it ${now}.`,
    };
  }
  return {
    caption: `${Now} now · turns ${after}`,
    hint: `${Now} now. Saving the card turns it ${after}.`,
  };
}
