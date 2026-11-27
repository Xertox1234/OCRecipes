// server/services/day-progress-request.ts
/**
 * The model's request for a day progress card (Coach roadmap T3): it names
 * the day, never the numbers. Kept apart from day-progress.ts, which reads
 * storage, so the block parser (coach-blocks.ts) stays storage-free.
 */
import { z } from "zod";

export type DayProgressDay = "today" | "yesterday";

// Not strict: a key the model added (a title, made-up numbers) is dropped,
// not a reason to lose the card.
const dayProgressRequestSchema = z.object({
  type: z.literal("day_progress"),
  day: z.enum(["today", "yesterday"]),
});

/** The day a model-authored day_progress block asks for, if it is one. */
export function readDayProgressRequest(
  raw: unknown,
): DayProgressDay | undefined {
  const parsed = dayProgressRequestSchema.safeParse(raw);
  return parsed.success ? parsed.data.day : undefined;
}

// Coach roadmap T3, the week card: the request names nothing (always the last
// seven days ending today). Not strict, like the day's.
const weekProgressRequestSchema = z.object({
  type: z.literal("week_progress"),
});

/** Whether a model-authored block asks for the week progress card. */
export function isWeekProgressRequest(raw: unknown): boolean {
  return weekProgressRequestSchema.safeParse(raw).success;
}

// Coach roadmap T4, the compare card: the request names two scans by the
// ids get_recent_scans gave, never their numbers. Not strict, like the rest.
// A scan id is a 32-bit serial: a bigger number is no scan, and would only
// make the read fail.
const scanId = z.number().int().positive().max(2147483647);
const labelCompareRequestSchema = z.object({
  type: z.literal("label_compare"),
  scanIds: z
    .tuple([scanId, scanId])
    .refine(([a, b]) => a !== b, "two different scans"),
});

/** The two scan ids a model-authored label_compare block names, if it is one. */
export function readLabelCompareRequest(
  raw: unknown,
): [number, number] | undefined {
  const parsed = labelCompareRequestSchema.safeParse(raw);
  return parsed.success ? parsed.data.scanIds : undefined;
}

// Coach roadmap A3, the weekly report card: the request names one report by
// the id get_weekly_reports gave, never its numbers. Not strict, like the
// rest. A report id is a 32-bit serial too.
const weeklyReportRequestSchema = z.object({
  type: z.literal("weekly_report"),
  reportId: z.number().int().positive().max(2147483647),
});

/** The report a model-authored weekly_report block names, if it is one. */
export function readWeeklyReportRequest(raw: unknown): number | undefined {
  const parsed = weeklyReportRequestSchema.safeParse(raw);
  return parsed.success ? parsed.data.reportId : undefined;
}
