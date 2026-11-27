import {
  classifyIntent,
  matchesDisorderedEating,
  type CoachIntent,
} from "../coach-intent-classifier";
import { extractBlockFences, stripCitationMarkers } from "../coach-reply-text";
import {
  SAFETY_REFUSAL_FALLBACK_MESSAGE,
  STANDARD_SAFETY_MESSAGE,
  isFlatModelRefusal,
} from "../../lib/ai-safety";

/*
 * The steps that turn a model's output into the text a user sees, shared by
 * the chat turn and the coach eval so the eval scores that text, not the raw
 * stream (audit 2026-11-24, M29).
 */

/**
 * The turn's intents, classified once from the message as sent. `classified`
 * routes the finder; `prompt` is what the model's prompt gets. A
 * recipe_request that does not enter the finder (flag off, free Coach, a turn
 * routed elsewhere) keeps the prompt intent it had before that intent existed
 * (spec §8).
 */
export function coachTurnIntents(safetyText: string): {
  classified: CoachIntent;
  prompt: CoachIntent;
} {
  const { intent: classified } = classifyIntent(safetyText);
  const prompt =
    classified === "recipe_request"
      ? classifyIntent(safetyText, { recipeRequests: false }).intent
      : classified;
  return { classified, prompt };
}

/**
 * The free reply as it was shown, saved and cached: without the model's
 * citation markup, and without a card fence the free tier never asked for.
 */
export function freeReplyShownText(raw: string): string {
  return stripCitationMarkers(extractBlockFences(raw).text).trim();
}

/**
 * The model sometimes answers a safety-sensitive turn (distress, disordered
 * eating) with only a bare refusal. Returns the text that replaces it, or
 * null when the reply stands. The warm fallback is worded for distress about
 * eating; other safety turns (medical, injection, ...) get the generic
 * referral message. A suicide or self-harm message never gets here:
 * handleCoachChat answers it with the crisis message before any model call.
 */
export function flatRefusalReplacement(
  content: string,
  reply: string,
  intent: CoachIntent,
): string | null {
  if (intent !== "safety_refusal" || !isFlatModelRefusal(reply)) return null;
  return matchesDisorderedEating(content)
    ? SAFETY_REFUSAL_FALLBACK_MESSAGE
    : STANDARD_SAFETY_MESSAGE;
}
