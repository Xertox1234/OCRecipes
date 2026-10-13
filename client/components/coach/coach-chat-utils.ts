import {
  coachBlockSchema,
  mealPlanCardSchema,
  type CoachBlock,
  type MealPlanDay,
} from "@shared/schemas/coach-blocks";
import {
  MEAL_LABELS,
  type MealType,
} from "@/screens/meal-plan/meal-plan-utils";

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
 * Success toast copy for "Add to Plan", naming the chosen day and meal so a
 * mis-filed slot (e.g. a local-vs-UTC date bug on write) is visible in the
 * confirmation itself, not just on the Plan tab.
 *
 * Takes `dayLabel` as a plain string (the tapped chip's own `weekday`, e.g.
 * "Wednesday") rather than the `plannedDate` ISO string — do NOT change this
 * to re-derive the day by parsing `plannedDate`. `plannedDate` is the device's
 * LOCAL calendar day, but `new Date(plannedDate)` parses a bare date as UTC
 * midnight, so re-parsing it back into a weekday renders the *previous* day at
 * any UTC-NEGATIVE offset, which would make this toast contradict the very
 * chip the user just tapped. A `plannedDate` must always be built from the
 * device's LOCAL date parts, never `toISOString()` (which is UTC).
 *
 * The sign is a trap: the original write-side bug was UTC-POSITIVE-only, so
 * this guard looks unnecessary when tested from Europe or Oceania. Dropping it
 * breaks the Americas instead.
 */
export function formatPlanSaveSuccess(
  dayLabel: string,
  mealType: MealType,
): string {
  return `Added to ${dayLabel} ${MEAL_LABELS[mealType]}`;
}

/**
 * `formatPlanSaveSuccess` for callers that only hold the ISO `plannedDate`
 * (the meal-plan sheets, recipe browser and wizard). The weekday is rebuilt
 * from the date's parts as a LOCAL date — never `new Date(iso)`, which reads
 * UTC midnight and names the previous day at UTC-negative offsets (see
 * `formatPlanSaveSuccess` above).
 */
export function formatPlanAddSuccess(
  plannedDate: string,
  mealType: string,
): string {
  const [year, month, day] = plannedDate.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
  });
  // Route params type the meal as a plain string; an unknown value still
  // confirms the add, just without a meal label.
  return Object.hasOwn(MEAL_LABELS, mealType)
    ? formatPlanSaveSuccess(weekday, mealType as MealType)
    : `Added to ${weekday}`;
}
