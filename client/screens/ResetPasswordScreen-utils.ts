/**
 * Pure helpers for ResetPasswordScreen, extracted for unit testing.
 * Spec: docs/superpowers/specs/2026-10-03-password-reset-design.md §5.
 */
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import {
  RESET_CODE_LENGTH,
  RESET_RESEND_COOLDOWN_SECONDS,
} from "@shared/constants/password-reset";
import { validateNewPassword } from "./LoginScreen-utils";

/**
 * The ONE failure message for a rejected code. Deliberately never says the
 * tries are used up — that would reveal a code exists for the email.
 */
export const INVALID_RESET_CODE_MESSAGE =
  "That code is incorrect or expired. After 5 wrong tries, request a new code.";

/** Keep digits only (autofill/paste may add spaces or a dash), max 6. */
export function normalizeResetCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, RESET_CODE_LENGTH);
}

export function validateResetForm(input: {
  code: string;
  password: string;
  confirmPassword: string;
}): string | null {
  if (input.code.length !== RESET_CODE_LENGTH) {
    return "Enter the 6-digit code from the email";
  }
  return validateNewPassword(input.password, input.confirmPassword);
}

/** Static copy keyed on ApiError.code/status — never error.message. */
export function getResetErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "INVALID_RESET_CODE") return INVALID_RESET_CODE_MESSAGE;
    if (err.status === 429) {
      return "Too many attempts. Please wait a few minutes and try again.";
    }
    if (err.code === "VALIDATION_ERROR") {
      return "Please check the code and your new password, then try again.";
    }
  }
  return "Couldn't reset your password right now. Please try again shortly.";
}

export function resendSecondsRemaining(
  lastSentAt: number,
  now: number,
): number {
  const endsAt = lastSentAt + RESET_RESEND_COOLDOWN_SECONDS * 1000;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export async function resetPasswordRequest(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await apiRequest("POST", "/api/auth/reset-password", {
    email: email.trim(),
    code,
    newPassword,
  });
}
