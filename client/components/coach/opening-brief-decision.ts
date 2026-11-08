/**
 * When the Coach tab opens a fresh chat with the opening brief, and which
 * form of the brief to show. Decided ONCE, at mount, from values already in
 * memory — the screen never switches away from a chat after a later fetch
 * lands (spec: 2026-11-08-coach-opening-brief-design, "decided once").
 */
import type { BriefForm } from "@shared/lib/opening-brief";

/** The device-local calendar date, YYYY-MM-DD. */
export function localDateString(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function shouldOpenBriefDraft(a: {
  hasPendingReminder: boolean;
  /** `undefined` until the saved date has been read. */
  lastSeen: string | null | undefined;
  today: string;
  /** A deep link or selection named a conversation: always open that. */
  hasExplicitConversation: boolean;
}): boolean {
  if (a.hasExplicitConversation) return false;
  if (a.hasPendingReminder) return true;
  // Unknown is not "first visit": don't pull the user into a draft on a
  // guess (the default is today's behaviour).
  if (a.lastSeen === undefined) return false;
  return a.lastSeen !== a.today;
}

export function briefFormFor(
  lastSeen: string | null | undefined,
  today: string,
  hasPendingReminder: boolean,
): BriefForm {
  return lastSeen === today && !hasPendingReminder ? "short" : "full";
}
