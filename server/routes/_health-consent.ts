import type { Response } from "express";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";

/**
 * Health-data consent gate for write routes (privacy audit H2 — "no consent,
 * no health data"). The rule and the field list live in
 * `shared/lib/health-consent.ts`.
 */

/** True when the user's profile carries a health-data consent. */
export async function hasHealthConsent(userId: string): Promise<boolean> {
  const profile = await storage.getUserProfile(userId);
  return profile?.healthDataConsentAt != null;
}

export function sendHealthConsentRequired(res: Response): void {
  sendError(
    res,
    403,
    "Agree to the health-data consent before adding health details",
    ErrorCode.HEALTH_CONSENT_REQUIRED,
  );
}

/**
 * Refuses a request that would add to or confirm Coach's notes while they are
 * paused (after a health-consent withdrawal; `coachNotesPaused` in
 * `shared/lib/health-consent.ts`). Returns true when it sent the refusal.
 */
export async function refusedWhileCoachNotesPaused(
  userId: string,
  res: Response,
): Promise<boolean> {
  if (!(await storage.areCoachNotesPaused(userId))) return false;
  sendError(
    res,
    403,
    "Coach's notes are off since you withdrew the health-data consent. Agree to it again to add or change notes.",
    ErrorCode.HEALTH_CONSENT_REQUIRED,
  );
  return true;
}
