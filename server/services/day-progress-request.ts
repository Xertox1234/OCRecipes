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
