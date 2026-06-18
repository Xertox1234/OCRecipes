/**
 * Pure helpers for LoginScreen, extracted for unit testing.
 *
 * Two responsibilities, both about NOT leaving the user stuck on a failed
 * signup:
 *
 * 1. `validateAuthForm` — client-side pre-flight that MIRRORS the server's
 *    `registerSchema` (server/routes/_schemas.ts). The common trap this exists
 *    for: a user types their **email address** into the "Username" field. The
 *    server rejects it (`^[a-zA-Z0-9_]+$`) with a 400 the UI used to swallow as
 *    a generic "Registration failed." Catching it here gives an actionable
 *    message instantly, with no wasted request against the 5/hour register
 *    rate limit. The server still re-validates with zero trust — this is UX,
 *    not a security boundary.
 *
 * 2. `getAuthErrorMessage` — maps a caught error to STATIC, user-safe copy.
 *    Per the `ocrecipes/no-error-message-in-ui` rule (docs/rules/client-state.md)
 *    we must never render `error.message` (it is the raw server body) — branch
 *    on `ApiError.code` instead.
 *
 * KEEP IN SYNC (manual): the rules/messages below mirror `registerSchema`. If
 * the server schema changes, update both. They are intentionally NOT shared
 * from the server module, which pulls in server-only imports.
 */
import { ApiError } from "@/lib/api-error";

export type AuthMode = "login" | "register";

// Mirrors registerSchema.username: 3–30 chars, letters/numbers/underscore only.
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
// Mirrors registerSchema.password complexity: at least one letter AND one digit.
const PASSWORD_COMPLEXITY = /(?=.*[a-zA-Z])(?=.*\d)/;

const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const PASSWORD_MIN = 8;

export interface AuthFormInput {
  mode: AuthMode;
  username: string;
  password: string;
  confirmPassword: string;
  ageConfirmed: boolean;
}

/**
 * Returns a static, user-facing message for the FIRST failing rule, or null
 * when the input passes client-side checks. Login is intentionally lenient
 * (only "fields present") — the server is the authority and a generic failure
 * avoids a username-enumeration oracle.
 */
export function validateAuthForm(input: AuthFormInput): string | null {
  const username = input.username.trim();

  if (!username || !input.password.trim()) {
    return "Please fill in all fields";
  }

  if (input.mode === "login") {
    return null;
  }

  // --- register-only rules (mirror registerSchema) ---
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Username must be between ${USERNAME_MIN} and ${USERNAME_MAX} characters`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    // Name the email trap explicitly — it is by far the most common cause.
    return "Username can only contain letters, numbers, and underscores (it can't be an email address)";
  }
  if (input.password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters`;
  }
  if (!PASSWORD_COMPLEXITY.test(input.password)) {
    return "Password must contain at least one letter and one number";
  }
  if (input.password !== input.confirmPassword) {
    return "Passwords do not match";
  }
  if (!input.ageConfirmed) {
    return "You must confirm you are 13 years of age or older";
  }
  return null;
}

/**
 * Maps a caught auth error to STATIC, mode-specific copy. Never reads
 * `error.message` (raw server body) — branches on `ApiError.code` only, per
 * the `no-error-message-in-ui` rule. Surfaces a helpful message for the
 * rate-limit case (otherwise indistinguishable from a generic failure); all
 * other failures fall back to the generic mode copy.
 */
export function getAuthErrorMessage(error: unknown, mode: AuthMode): string {
  if (error instanceof ApiError && error.code === "RATE_LIMITED") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  return mode === "login"
    ? "Incorrect username or password. Please try again."
    : "Registration failed. Please try again.";
}
