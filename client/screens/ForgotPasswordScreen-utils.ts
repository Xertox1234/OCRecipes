/**
 * Pure helpers for ForgotPasswordScreen, extracted for unit testing.
 * Spec: docs/superpowers/specs/2026-10-03-password-reset-design.md §5.
 */
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";

// Pragmatic client mirror; the server re-validates with zero trust.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidResetEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export async function requestResetCode(email: string): Promise<void> {
  await apiRequest("POST", "/api/auth/forgot-password", {
    email: email.trim(),
  });
}

/**
 * Static copy only (never error.message). A 429 comes from the per-email /
 * per-IP limiters, which run BEFORE the account lookup — so it is identical
 * for real and unknown addresses and safe to state plainly. The two limiters
 * send the same body, so the copy names neither the reason nor the wait.
 */
export function getResetRequestErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) {
    return "Too many code requests. Please wait a while and try again.";
  }
  if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
    return "Please enter a valid email address.";
  }
  return "Couldn't send a code right now. Please try again shortly.";
}
