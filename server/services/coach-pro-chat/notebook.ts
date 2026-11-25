import { civilDateToInstant } from "../../lib/civil-date";
import { storage } from "../../storage";
import { MAX_NOTEBOOK_ENTRIES } from "@shared/schemas/coach-notebook";
import { extractNotebookEntries } from "../notebook-extraction";
import { hashNotebookDedupeKey } from "../coach-cache-keys";

/**
 * In-memory record of the last time we attempted `archiveOldEntries` for a
 * given user. Bounded by an LRU eviction so long-running processes do not
 * grow this map indefinitely.
 */
const ARCHIVE_THROTTLE_MS = 24 * 60 * 60 * 1000; // once per day per user
export const lastArchivedAt = new Map<string, number>();
const LAST_ARCHIVED_MAX_ENTRIES = 10_000;

export function shouldRunArchive(userId: string, now: number): boolean {
  const prev = lastArchivedAt.get(userId);
  if (prev && now - prev < ARCHIVE_THROTTLE_MS) return false;
  // Simple bound: if we hit capacity, drop the oldest insertion.
  if (
    lastArchivedAt.size >= LAST_ARCHIVED_MAX_ENTRIES &&
    !lastArchivedAt.has(userId)
  ) {
    const firstKey = lastArchivedAt.keys().next().value;
    if (firstKey !== undefined) lastArchivedAt.delete(firstKey);
  }
  lastArchivedAt.set(userId, now);
  return true;
}

export { ARCHIVE_THROTTLE_MS };

/**
 * Notebook extraction + archival for a completed Coach Pro turn. Run
 * fire-and-forget by `handleCoachChat`.
 */
export async function extractAndStoreNotebook(a: {
  messageHistory: { role: "user" | "assistant" | "system"; content: string }[];
  content: string;
  textContent: string;
  userId: string;
  conversationId: number;
  /** Turn-start instant. */
  today: Date;
  tz: string;
  /** The reply carries a write card built this turn. */
  wroteCard: boolean;
  /**
   * A turn the safety router refused or the safety screen replaced: the mood
   * nudge is still taken (a distressed message should soften Coach's tone on
   * later turns), but no note is saved from what the user asked for.
   */
  moodOnly?: boolean;
}): Promise<void> {
  const {
    messageHistory,
    content,
    textContent,
    userId,
    conversationId,
    today,
    tz,
    wroteCard,
  } = a;
  // Without the health-data consent Coach saves no notes (owner ruling
  // 2026-11-24). Checked first: the extraction below is a paid model call.
  if (await storage.areCoachNotesPaused(userId)) return;
  // The history normally ends with this turn's question already (the route
  // saves it before the stream); adding it again weighted it twice.
  const last = messageHistory[messageHistory.length - 1];
  const endsWithQuestion = last?.role === "user" && last.content === content;
  const allMessages = [
    ...messageHistory,
    ...(endsWithQuestion ? [] : [{ role: "user" as const, content }]),
    { role: "assistant" as const, content: textContent },
  ];
  const entries = await extractNotebookEntries(
    allMessages,
    userId,
    conversationId,
    // `today` (declared above) is the turn-start instant, captured
    // before the coach's own response streams — passing it here
    // anchors the extraction prompt's "Current date" line to when the
    // user SPOKE, not a later `new Date()` computed after the SSE
    // stream drains. NOTE: this is not guaranteed to be the identical
    // instant the coach's own system prompt rendered its date from —
    // that is a separate, independently-defaulted `new Date()` in
    // coach-prompt.ts's `buildSystemPrompt` — just the closer and
    // more correct of the two available anchors.
    { now: today, tz, wroteCard },
  );
  // The mood nudge was applied inside the extraction above.
  if (a.moodOnly) return;
  // The account ceiling bounds what the Coach writes on its own too: only as
  // many as there is room for.
  const room =
    entries.length > 0
      ? MAX_NOTEBOOK_ENTRIES - (await storage.getNotebookEntryTotal(userId))
      : 0;
  const toWrite = entries.slice(0, Math.max(0, room));
  // Checked again: the extraction above takes seconds, and a withdrawal (with
  // "delete the notes") can land while it runs.
  if (toWrite.length > 0 && !(await storage.areCoachNotesPaused(userId))) {
    // Build a per-entry dedup fingerprint so SSE retries that replay
    // the same conversation turn do not create duplicate rows. The
    // unique index on `dedupeKey` combined with `onConflictDoNothing`
    // at the storage layer is what actually enforces this.
    await storage.createNotebookEntries(
      toWrite.map((e) => ({
        userId,
        type: e.type,
        content: e.content,
        label: e.label,
        status: "active",
        // `civilDateToInstant`, not `new Date(dateStr)`: a bare parse
        // anchors at UTC midnight, which is BEFORE local midnight for
        // every UTC-negative user, so `getDueCommitmentsAllUsers` /
        // `getCommitmentsWithDueFollowUp` (coach-notebook.ts) — both
        // plain `lte(followUpDate, now)` instant comparisons — fire the
        // push reminder hours early. Anchoring correctly at write time
        // fixes both reads — neither needs its own timezone-aware
        // comparison. `server/routes/notebook.ts`'s POST/PATCH handlers
        // (the manual add/edit-entry screen) write the same column on
        // the same basis; a cross-surface test pins that they agree.
        // Rows written before either fix keep their UTC-midnight anchor.
        followUpDate: e.followUpDate
          ? civilDateToInstant(e.followUpDate, tz)
          : null,
        sourceConversationId: conversationId,
        dedupeKey: hashNotebookDedupeKey({
          userId,
          conversationId,
          entryType: e.type,
          entryContent: e.content,
          lastUserMessage: content,
          lastAssistantMessage: textContent,
        }),
      })),
    );
  }
  // Archive notebook entries older than 30 days to bound growth.
  // Time-gated to once per day per user so we do not hammer the DB
  // on every assistant turn.
  if (shouldRunArchive(userId, Date.now())) {
    await storage.archiveOldEntries(userId, 30);
  }
}
