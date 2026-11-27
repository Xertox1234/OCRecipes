import { currentJudgeModel } from "./lib/judge-generic";
import { buildUserContextLines } from "../server/services/coach-prompt";
import type { CoachContext } from "../server/services/coach-prompt";

export { currentJudgeModel };

/**
 * Context summary shown to the LLM judge: the coach prompt's own USER CONTEXT
 * lines, rendered with the clock and timezone the reply was generated with,
 * so the judge sees exactly what the model saw. A hand-written copy left the
 * notebook, screen, frequent foods, due commitments and the time out of the
 * judge's view while the model was being scored on using them (audit
 * 2026-11-24, M28).
 */
export function formatContextSummary(
  context: CoachContext,
  clock: { now?: Date; tz?: string } = {},
): string {
  return buildUserContextLines(context, clock).join("\n").trim();
}
