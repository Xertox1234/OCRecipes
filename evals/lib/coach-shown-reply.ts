import {
  generateCoachResponse,
  SAFETY_OVERRIDE_SENTINEL,
  PROVIDER_FAILURE_SENTINEL,
} from "../../server/services/nutrition-coach";
import { matchesSelfHarm } from "../../server/services/coach-intent-classifier";
import {
  coachTurnIntents,
  flatRefusalReplacement,
  freeReplyShownText,
} from "../../server/services/coach-pro-chat/visible-reply";
import {
  SAFETY_CRISIS_FALLBACK_MESSAGE,
  SAFETY_REFUSAL_FALLBACK_MESSAGE,
  STANDARD_SAFETY_MESSAGE,
} from "../../server/lib/ai-safety";
import type { CoachContext } from "../../server/services/coach-prompt";

export type CoachGenerator = typeof generateCoachResponse;

/**
 * The free-tier reply a user would see for one message: the same steps as
 * handleCoachChat and streamReply (crisis reply without a model call,
 * production intent, unsafe-stream override, shown-text cleanup, flat-refusal
 * swap). The eval scores this text, not the raw stream (audit 2026-11-24, M29).
 */
export async function coachShownReply(
  message: string,
  context: CoachContext,
  clock: { now: Date; tz: string },
  generate: CoachGenerator = generateCoachResponse,
): Promise<{ text: string; modelCalled: boolean }> {
  if (matchesSelfHarm(message)) {
    return { text: SAFETY_CRISIS_FALLBACK_MESSAGE, modelCalled: false };
  }
  const { prompt: intent } = coachTurnIntents(message);
  let raw = "";
  for await (const chunk of generate(
    [{ role: "user", content: message }],
    context,
    undefined,
    intent,
    clock.tz,
    clock.now,
  )) {
    // A failed provider call is not a reply to score: the sample errors, as
    // the chat turn does (audit 2026-11-24, M13).
    if (chunk === PROVIDER_FAILURE_SENTINEL) {
      throw new Error("Coach provider failed; no reply to score");
    }
    if (chunk === SAFETY_OVERRIDE_SENTINEL) {
      return { text: STANDARD_SAFETY_MESSAGE, modelCalled: true };
    }
    raw += chunk;
  }
  const shown = freeReplyShownText(raw);
  return {
    text: flatRefusalReplacement(message, shown, intent) ?? shown,
    modelCalled: true,
  };
}

const CANNED = new Set([
  STANDARD_SAFETY_MESSAGE,
  SAFETY_REFUSAL_FALLBACK_MESSAGE,
  SAFETY_CRISIS_FALLBACK_MESSAGE,
]);

/** True when the reply is one the server wrote, not the model. */
export function isCannedSafetyText(text: string): boolean {
  return CANNED.has(text);
}
