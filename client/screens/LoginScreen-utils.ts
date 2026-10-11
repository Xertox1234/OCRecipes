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
 * KEEP IN SYNC (manual): the username/email rules below mirror
 * `registerSchema`. If the server schema changes, update both. They are
 * intentionally NOT shared from the server module, which pulls in server-only
 * imports. The PASSWORD rule is not mirrored: it is imported from
 * `@shared/constants/password-policy`, the same module the server uses.
 */
import { ApiError } from "@/lib/api-error";
import {
  PASSWORD_MIN_SINGLE_FACTOR,
  newPasswordProblem,
  passwordMessage,
  type PasswordContext,
} from "@shared/constants/password-policy";

export type AuthMode = "login" | "register";

// Mirrors registerSchema.username: 3–30 chars, letters/numbers/underscore only.
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
// Pragmatic client mirror of registerSchema.email (server re-validates, zero trust).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USERNAME_MIN = 3;
const USERNAME_MAX = 30;

/** Exported so the reset screen can tell a mismatch (confirm field) apart. */
export const PASSWORD_MISMATCH_MESSAGE = "Passwords do not match";

export const BREACHED_PASSWORD_MESSAGE =
  "That password has appeared in a data breach. Choose a different one.";

/**
 * New-password check shared by sign-up and the reset screen: length for the
 * given minimum (counted in characters, no composition rule), then the match.
 */
export function validateNewPassword(
  password: string,
  confirmPassword: string,
  opts: { min: number; context: PasswordContext },
): string | null {
  const problem = newPasswordProblem(password, { min: opts.min });
  if (problem) {
    return passwordMessage(problem, opts.context);
  }
  if (password !== confirmPassword) {
    return PASSWORD_MISMATCH_MESSAGE;
  }
  return null;
}

export interface AuthFormInput {
  mode: AuthMode;
  username: string;
  password: string;
  confirmPassword: string;
  ageConfirmed: boolean;
  email: string;
}

/**
 * Username rule shared by password sign-up and the Google/Apple
 * ChooseUsername screen (mirrors registerSchema). Expects a trimmed value.
 */
export function validateUsername(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Username must be between ${USERNAME_MIN} and ${USERNAME_MAX} characters`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    // Name the email trap explicitly — it is by far the most common cause.
    return "Username can only contain letters, numbers, and underscores (it can't be an email address)";
  }
  return null;
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
  const usernameError = validateUsername(username);
  if (usernameError) return usernameError;
  const email = input.email.trim();
  if (!email) {
    return "Please enter your email address";
  }
  if (!EMAIL_PATTERN.test(email)) {
    return "Please enter a valid email address";
  }
  const passwordError = validateNewPassword(
    input.password,
    input.confirmPassword,
    { min: PASSWORD_MIN_SINGLE_FACTOR, context: "signup" },
  );
  if (passwordError) return passwordError;
  if (!input.ageConfirmed) {
    return "You must confirm you are 13 years of age or older";
  }
  return null;
}

/**
 * Per-field validation errors. Currently only the email field is attributed,
 * which is all the email `TextInput` needs to set `aria-invalid` on itself
 * (the form-level banner still uses `validateAuthForm`). `email` is `null` when
 * the email field is valid or not applicable to the current mode.
 */
export interface AuthFieldErrors {
  email: string | null;
}

/**
 * Field-attributed validation, used to set `error`/`errorMessage` (and thus
 * `aria-invalid`) on individual inputs. Login stays LENIENT — in login mode the
 * email field is not shown, so this never produces an email error and never
 * introduces a username-enumeration oracle. The email rules MIRROR the
 * email checks in `validateAuthForm` above (KEEP IN SYNC, same `EMAIL_PATTERN`).
 */
export function validateAuthFormFields(input: AuthFormInput): AuthFieldErrors {
  if (input.mode === "login") {
    return { email: null };
  }

  const email = input.email.trim();
  if (!email) {
    return { email: "Please enter your email address" };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { email: "Please enter a valid email address" };
  }
  return { email: null };
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
  if (mode === "register" && error instanceof ApiError) {
    if (error.code === "PASSWORD_TOO_SHORT") {
      return passwordMessage("too_short", "signup");
    }
    if (error.code === "PASSWORD_BREACHED") return BREACHED_PASSWORD_MESSAGE;
  }
  return mode === "login"
    ? "Incorrect username or password. Please try again."
    : "Registration failed. Please try again.";
}
