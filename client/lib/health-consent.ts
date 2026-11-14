import { hasHealthData } from "@shared/lib/health-consent";
import { AI_RECIPIENT_NAMES } from "@shared/lib/ai-sharing";

/**
 * Client side of "no consent, no health data" (privacy audit H2). The server
 * refuses a health field without the consent; these helpers let a screen ask
 * for it first instead of showing a failed save.
 */

/** The part of the dietary profile the consent check reads. */
interface ConsentRecord {
  healthDataConsentAt?: string | null;
}

/** True once the server has stamped a health-data consent on the profile. */
export function hasConsented(
  profile: ConsentRecord | null | undefined,
): boolean {
  return profile?.healthDataConsentAt != null;
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
    "This removes your allergies, health conditions and medications, diet type, body measurements, activity level and goal from OCRecipes. Allergy warnings and personalized targets stop until you add them again. Your food logs, recipes, calorie targets, chats and the notes Coach has saved stay; clear those notes under Coach → What Coach knows.",
  confirmLabel: "Withdraw and remove",
  destructive: true,
} as const;
