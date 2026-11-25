import { coachNotesPaused, hasHealthData } from "@shared/lib/health-consent";
import { AI_RECIPIENT_NAMES } from "@shared/lib/ai-sharing";

/**
 * Client side of "no consent, no health data" (privacy audit H2). The server
 * refuses a health field without the consent; these helpers let a screen ask
 * for it first instead of showing a failed save.
 */

/** The part of the dietary profile the consent check reads. */
interface ConsentRecord {
  healthDataConsentAt?: string | null;
  healthDataConsentWithdrawnAt?: string | null;
}

/** True once the server has stamped a health-data consent on the profile. */
export function hasConsented(
  profile: ConsentRecord | null | undefined,
): boolean {
  return profile?.healthDataConsentAt != null;
}

/**
 * True when Coach's notes are off for this user, by the server's own rule
 * (`coachNotesPaused`). False until the profile has loaded (`loaded`), so a
 * screen never takes a control away on a guess.
 */
export function coachNotesOff(
  profile: ConsentRecord | null | undefined,
  loaded: boolean,
): boolean {
  return loaded && coachNotesPaused(profile);
}

/** True when saving `payload` would store a health detail without consent. */
export function needsHealthConsent(
  profile: ConsentRecord | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  return !hasConsented(profile) && hasHealthData(payload);
}

/** The consent question, asked where health details are added after setup. */
export const HEALTH_CONSENT_PROMPT = {
  title: "Use your health details?",
  message: `Allergies, health conditions and medications, diet type, body measurements, activity and goals are health information. We use them to personalize nutrition recommendations and AI coaching. With AI features on, the details a feature needs go to the AI companies that run it: ${AI_RECIPIENT_NAMES}. They are never sold or shared with advertisers, and you can withdraw this consent any time in Settings.`,
  confirmLabel: "Agree",
  cancelLabel: "Not now",
} as const;

export const WITHDRAW_HEALTH_CONSENT_PROMPT = {
  title: "Withdraw health-data consent",
  message:
    "This removes your allergies, health conditions and medications, diet type, body measurements, activity level and goal from OCRecipes. Allergy warnings and personalized targets stop until you add them again. Your food logs, recipes, calorie targets and chats stay. Coach stops using the notes it has saved about you until you agree again.",
  confirmLabel: "Withdraw and remove",
  destructive: true,
} as const;

/**
 * Asked after the withdrawal is confirmed, when Coach has saved notes (owner
 * ruling 2026-11-24). Either answer goes on to withdraw; closing the sheet
 * keeps the notes.
 */
export const COACH_NOTES_AT_WITHDRAWAL_PROMPT = {
  title: "Delete Coach's notes too?",
  message:
    "Coach has saved notes about you from your chats, and some may mention your health. Coach won't use them unless you agree to the health-data consent again. Delete them now, or keep them: you can still see and delete them under Coach → What Coach knows.",
  confirmLabel: "Delete notes",
  cancelLabel: "Keep notes",
  destructive: true,
} as const;

/** The user's answer to COACH_NOTES_AT_WITHDRAWAL_PROMPT. */
export type CoachNotesChoice = "delete" | "keep";
