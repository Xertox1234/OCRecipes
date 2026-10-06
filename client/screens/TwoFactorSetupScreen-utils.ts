/**
 * Pure helpers for TwoFactorSetupScreen, extracted for unit testing.
 * Plan: docs/superpowers/plans/2026-10-05-totp-second-factor.md (Task 11).
 */
import { ApiError } from "@/lib/api-error";

/** "ABCDEFGH…" → "ABCD EFGH …" — easier to read and to type by hand. */
export function formatSetupKey(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/** What "Copy all" puts on the clipboard. */
export function recoveryCodesText(codes: string[]): string {
  return `OCRecipes recovery codes — each works once\n\n${codes.join("\n")}`;
}

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "That didn't match. Please try again.",
  INVALID_PROVIDER_TOKEN:
    "That sign-in couldn't be confirmed. Please try again.",
  MFA_CODE_INVALID:
    "That code didn't work. Check your authenticator app and try again.",
  MFA_LOCKED: "Too many wrong codes. Try again in 15 minutes.",
  MFA_UNAVAILABLE:
    "Two-step verification isn't available right now. Please try again later.",
  MFA_ALREADY_ENABLED: "Two-step verification is already on.",
  MFA_NOT_ENABLED: "Two-step verification is already off.",
};

/** Static copy keyed on ApiError.code/status — never error.message. */
export function getTwoFactorErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
    if (err.status === 429) {
      return "Too many attempts. Please wait a few minutes and try again.";
    }
  }
  return "Something went wrong. Please try again.";
}
