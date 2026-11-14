import { z } from "zod";

export const notebookEntryTypes = [
  "insight",
  "commitment",
  "preference",
  "goal",
  "motivation",
  "emotional_context",
  "conversation_summary",
  "coaching_strategy",
] as const;

export type NotebookEntryType = (typeof notebookEntryTypes)[number];

export const notebookEntryStatusValues = [
  "active",
  "completed",
  "expired",
  "archived",
  // Undone or removed by the user; kept so extraction never re-saves it.
  "rejected",
] as const;

export type NotebookEntryStatus = (typeof notebookEntryStatusValues)[number];

export const notebookEntrySchema = z.object({
  type: z.enum(notebookEntryTypes),
  content: z.string().min(1).max(500),
  /** Short second-person label for a commitment ("pumpkin seeds on your salad"). */
  label: z.string().min(2).max(60).nullable().optional(),
  // Anchored ISO date (`YYYY-MM-DD`). Loose AI values like "next week" or
  // "2026-04-17T10:00" are rejected at the Zod layer so they never reach
  // `new Date(...)` in the write path.
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date format (YYYY-MM-DD)")
    .nullable()
    .optional(),
});

const MOOD_DELTAS = [-1, -0.5, 0, 0.5, 1] as const;
type MoodDelta = (typeof MOOD_DELTAS)[number];

export const extractionResultSchema = z.object({
  entries: z.array(notebookEntrySchema).max(10),
  /** Nudge to the user's mood score from this turn's tone (spec 2026-11-08). */
  // Lenient on purpose: a stray value (null, 0.25, "0") becomes 0 rather
  // than failing the parse and discarding this turn's entries with it.
  moodDelta: z
    .unknown()
    .optional() // zod 4: a bare z.unknown() key is required — keep absent → 0
    .transform(
      (v): MoodDelta =>
        MOOD_DELTAS.includes(v as MoodDelta) ? (v as MoodDelta) : 0,
    ),
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;
