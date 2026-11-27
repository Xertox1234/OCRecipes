import { z } from "zod";
import { coachContextSchema, evalTestCaseSchema } from "../types";
import { coachProChecksSchema } from "./coach-pro-checks";

/**
 * A Coach Pro eval case (audit 2026-11-24, M30): the free case shape plus
 * the turns before this one, the app features the client turns on, read-tool
 * fixtures and the Pro checks. The context accepts the Pro-only fields the
 * free schema leaves out (it would silently drop them).
 */
export const coachProCaseSchema = evalTestCaseSchema.extend({
  userMessage: z.string().min(1),
  context: coachContextSchema.extend({
    notebookBackground: z.string().optional(),
    moodBand: z.enum(["low", "neutral", "good"]).optional(),
    mealPatternSummary: z.string().optional(),
    liveWriteCard: z.string().optional(),
    notesPaused: z.boolean().optional(),
  }),
  /** Earlier turns, oldest first, as the chat history sends them. */
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .default([]),
  /** What the client sends; omitted flags are off. */
  flags: z
    .object({
      writeCards: z.boolean().optional(),
      pantryCard: z.boolean().optional(),
      goalsCard: z.boolean().optional(),
      quickLog: z.boolean().optional(),
      offer: z.boolean().optional(),
      dayProgress: z.boolean().optional(),
      weekProgress: z.boolean().optional(),
    })
    .default({}),
  /** Read-tool results by tool name; a tool without one gets "Nothing found." */
  fixtures: z.record(z.string(), z.unknown()).default({}),
  pro: coachProChecksSchema.optional(),
});
export type CoachProCase = z.infer<typeof coachProCaseSchema>;

export const coachProCasesSchema = z
  .array(coachProCaseSchema)
  .refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, {
    message: "case ids must be unique",
  });
