import {
  coachBlockSchema,
  mealPlanCardSchema,
  type CoachBlock,
  type MealPlanDay,
} from "@shared/schemas/coach-blocks";

/**
 * Validates and parses raw plan data from a block action into typed MealPlanDay[].
 * Returns undefined if the data is missing or fails Zod validation.
 */
export function parsePlanDays(raw: unknown): MealPlanDay[] | undefined {
  const parsed = mealPlanCardSchema.shape.days.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Builds an accessibility label for the AI meal plan banner.
 */
export function planBannerA11yLabel(days: MealPlanDay[]): string {
  const totalMeals = days.reduce((sum, d) => sum + d.meals.length, 0);
  const dayWord = days.length === 1 ? "day" : "days";
  const mealWord = totalMeals === 1 ? "meal" : "meals";
  return `AI meal plan with ${days.length} ${dayWord} and ${totalMeals} ${mealWord}`;
}

const COACH_BLOCKS_OPEN_FENCE = "```coach_blocks\n";
const COACH_BLOCKS_CLOSE_FENCE = "```";

/**
 * Strips the coach_blocks fence from accumulated XHR streaming text.
 * When a response is mid-stream, the closing ``` may not have arrived yet,
 * so this handles that case by stripping from the open fence to end-of-string.
 */
export function stripCoachBlocksFence(accumulated: string): string {
  const openIdx = accumulated.indexOf(COACH_BLOCKS_OPEN_FENCE);
  if (openIdx === -1) return accumulated.trim();
  const closeIdx = accumulated.indexOf(
    COACH_BLOCKS_CLOSE_FENCE,
    openIdx + COACH_BLOCKS_OPEN_FENCE.length,
  );
  if (closeIdx === -1) return accumulated.slice(0, openIdx).trim();
  // Remove the fence block: take text before open fence and text after close fence.
  // If after-text starts with \n, skip it to avoid double newline.
  let after = accumulated.slice(closeIdx + COACH_BLOCKS_CLOSE_FENCE.length);
  if (after.startsWith("\n")) after = after.slice(1);
  return (accumulated.slice(0, openIdx) + after).trim();
}

/**
 * Scan-offset state for `stripCoachBlocksFenceIncremental`, carried across
 * repeated calls on a growing `accumulated` string by the caller (e.g. one
 * ref per active coach stream). Reset it (via `createFenceScanState()`)
 * whenever `accumulated` itself is reset for a new/aborted stream.
 */
export interface FenceScanState {
  /** Index of the open fence marker in `accumulated`, or -1 while still searching. */
  openIdx: number;
  /** How far into `accumulated` the open-marker search has already covered. */
  openSearchedTo: number;
  /** Index of the close fence marker, or -1 while still searching / not applicable. */
  closeIdx: number;
  /** How far into `accumulated` the close-marker search has already covered. */
  closeSearchedTo: number;
}

export function createFenceScanState(): FenceScanState {
  return { openIdx: -1, openSearchedTo: 0, closeIdx: -1, closeSearchedTo: 0 };
}

/**
 * Equivalent to `stripCoachBlocksFence(accumulated)`, but for repeated calls
 * on a growing `accumulated` string (one SSE event at a time) it tracks how
 * far each marker search has already scanned in `state`, so a call only
 * re-scans the unsearched suffix (plus a small constant overlap — one marker
 * length minus one char — so a marker split across two chunks is never
 * missed) instead of re-running `indexOf` from position 0 on every event.
 * Before the fence is found, that full-string `indexOf` on every event is the
 * O(n^2) cost this replaces: it re-scans the entire accumulated response on
 * every token/chunk for the rest of the stream.
 *
 * Callers must pass the SAME `state` object across calls for one stream, and
 * a fresh `createFenceScanState()` when `accumulated` itself resets.
 */
export function stripCoachBlocksFenceIncremental(
  accumulated: string,
  state: FenceScanState,
): string {
  if (state.openIdx === -1) {
    const from = Math.max(
      0,
      state.openSearchedTo - (COACH_BLOCKS_OPEN_FENCE.length - 1),
    );
    const idx = accumulated.indexOf(COACH_BLOCKS_OPEN_FENCE, from);
    state.openSearchedTo = accumulated.length;
    if (idx === -1) return accumulated.trim();
    state.openIdx = idx;
    state.closeSearchedTo = idx + COACH_BLOCKS_OPEN_FENCE.length;
  }

  if (state.closeIdx === -1) {
    const from = Math.max(
      state.openIdx + COACH_BLOCKS_OPEN_FENCE.length,
      state.closeSearchedTo - (COACH_BLOCKS_CLOSE_FENCE.length - 1),
    );
    const idx = accumulated.indexOf(COACH_BLOCKS_CLOSE_FENCE, from);
    state.closeSearchedTo = accumulated.length;
    if (idx === -1) return accumulated.slice(0, state.openIdx).trim();
    state.closeIdx = idx;
  }

  let after = accumulated.slice(
    state.closeIdx + COACH_BLOCKS_CLOSE_FENCE.length,
  );
  if (after.startsWith("\n")) after = after.slice(1);
  return (accumulated.slice(0, state.openIdx) + after).trim();
}

/**
 * Filters an unknown array through coachBlockSchema, returning only valid blocks.
 */
export function filterValidBlocks(raw: unknown[]): CoachBlock[] {
  const valid: CoachBlock[] = [];
  for (const b of raw) {
    const result = coachBlockSchema.safeParse(b);
    if (result.success) valid.push(result.data);
  }
  return valid;
}

/**
 * Where VoiceOver's sentence-by-sentence reading of a streaming reply should
 * continue from. Tracking the announced TEXT rather than an index lets a
 * safety override, which replaces the reply mid-stream, start over at 0
 * instead of slicing the new text at an offset into the old one.
 */
export function announcedOffset(text: string, announced: string): number {
  return announced.length > 0 && text.startsWith(announced)
    ? announced.length
    : 0;
}

/**
 * What to announce when a streamed coach reply finishes.
 *
 * On iOS, CoachChat speaks each sentence as soon as it is followed by
 * whitespace. The reply's last sentence never is, so without this it was
 * never spoken. VoiceOver doesn't queue announcements, so it gets the
 * remainder in place of "Coach responded" rather than both. Android never
 * announces sentences, so it keeps the generic cue.
 */
export function getStreamFinishAnnouncement(
  fullText: string,
  announced: string,
  platform: "ios" | "android" | string,
): string {
  if (platform === "ios") {
    const remainder = fullText
      .slice(announcedOffset(fullText, announced))
      .trim();
    if (remainder.length > 0) return remainder;
  }
  return "Coach responded";
}

// ── Coach write cards (spec 2026-11-09) ─────────────────────────────

type WriteCardBlockLike = Extract<CoachBlock, { type: "write_card" }>;

/**
 * The card the chat's next message should carry edits for: the newest write
 * card in the chat, if it is still live (a saved or locked newest card means
 * none is live). `blockLists` is in chat order, oldest first.
 */
export function latestLiveWriteCard(
  blockLists: readonly (readonly CoachBlock[])[],
): { cardId: string; kind: WriteCardBlockLike["kind"] } | null {
  let newest: WriteCardBlockLike | null = null;
  for (const blocks of blockLists) {
    for (const b of blocks) if (b.type === "write_card") newest = b;
  }
  return newest?.status === "live"
    ? { cardId: newest.cardId, kind: newest.kind }
    : null;
}

/**
 * Locks every live write card older than the newest one, the way the server
 * already has: the card the newest names in `replacesCardId` shows
 * "Replaced", any other "Expired". Lets the chat lock an old card the moment
 * a new one streams in, before the refetch reports it. Blocks are replaced
 * only where a status changes.
 */
export function lockOlderWriteCards(
  blockLists: readonly CoachBlock[][],
): CoachBlock[][] {
  let newest: WriteCardBlockLike | null = null;
  for (const blocks of blockLists) {
    for (const b of blocks) if (b.type === "write_card") newest = b;
  }
  if (!newest) return blockLists as CoachBlock[][];
  const keep = newest;
  // By id, not identity: the finished reply's card can be on screen twice
  // (the footer's live copy and the saved message) for a moment.
  const older = (b: CoachBlock): b is WriteCardBlockLike =>
    b.type === "write_card" && b.cardId !== keep.cardId && b.status === "live";
  return blockLists.map((blocks) =>
    blocks.some(older)
      ? blocks.map((b) =>
          older(b)
            ? {
                ...b,
                status:
                  keep.replacesCardId === b.cardId ? "replaced" : "expired",
              }
            : b,
        )
      : blocks,
  );
}
