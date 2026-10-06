/**
 * Pure helpers for MfaChallengeScreen, extracted for unit testing.
 * Plan: docs/superpowers/plans/2026-10-05-totp-second-factor.md (Task 10).
 */
import { ApiError } from "@/lib/api-error";
import { TOTP_CODE_LENGTH } from "@shared/constants/mfa";

export type MfaInputMode = "code" | "recovery";

/** Digits only, capped at the code length (autofill/paste may add spaces). */
export function normalizeCodeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, TOTP_CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return code.length === TOTP_CODE_LENGTH;
}

/**
 * Static copy keyed on ApiError.code/status — never error.message.
 * `restart` = the challenge is gone; the person must sign in again.
 */
export function getMfaErrorMessage(
  err: unknown,
  mode: MfaInputMode,
): { message: string; restart: boolean } {
  if (err instanceof ApiError) {
    if (err.code === "MFA_CHALLENGE_INVALID") {
      return {
        message: "This sign-in expired. Please sign in again.",
        restart: true,
      };
    }
    if (err.code === "MFA_LOCKED") {
      return {
        message: "Too many wrong codes. Try again in 15 minutes.",
        restart: false,
      };
    }
    if (err.code === "MFA_CODE_INVALID") {
      return {
        message:
          mode === "recovery"
            ? "That recovery code didn't work. Check it and try again."
            : "That code didn't work. Check your authenticator app and try again.",
        restart: false,
      };
    }
    if (err.status === 429) {
      return {
        message: "Too many attempts. Please wait a few minutes and try again.",
        restart: false,
      };
    }
  }
  return {
    message: "Couldn't check that code. Please try again.",
    restart: false,
  };
}
