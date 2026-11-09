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

/** Undo shows this long after a save; the server allows 60 s. */
export const UNDO_VISIBLE_MS = 6000;

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
  }
  return "Couldn't save. Check your connection and try again.";
}

/** "Mon, Nov 9" for a plan row's yyyy-mm-dd (noon avoids a tz day-shift). */
export function planDayLabel(plannedDate: string): string {
  return new Date(`${plannedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
