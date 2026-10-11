/**
 * Pure helpers for PasswordUpgradeScreen (password policy spec §6), extracted
 * for unit testing. Copy is static per ApiError.code — never error.message
 * (`ocrecipes/no-error-message-in-ui`).
 */
import { ApiError } from "@/lib/api-error";
import { passwordMessage } from "@shared/constants/password-policy";
import { BREACHED_PASSWORD_MESSAGE } from "./LoginScreen-utils";

export const PASS_EXPIRED_MESSAGE =
  "This sign-in expired. Please sign in again.";
const TWO_STEP_CLOSED_MESSAGE =
  "Two-step verification isn't available right now. Choose a longer password instead.";
const TWO_STEP_CLOSED_CODES = new Set([
  "MFA_SETUP_DISABLED",
  "UPGRADE_TWO_STEP_NOT_ALLOWED",
  "MFA_UNAVAILABLE",
]);

/** The two-step choice is offered only when the pass allows it and setup is open. */
export function showTwoStepChoice(
  canUseTwoStep: boolean,
  twoStepClosed: boolean,
): boolean {
  return canUseTwoStep && !twoStepClosed;
}

export function isPassExpired(err: unknown): boolean {
  return err instanceof ApiError && err.code === "UPGRADE_PASS_EXPIRED";
}

/** Setup refused for good on this pass: hide the two-step choice. */
export function closesTwoStep(err: unknown): boolean {
  return err instanceof ApiError && TWO_STEP_CLOSED_CODES.has(err.code ?? "");
}

export function upgradeMessageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "UPGRADE_PASS_EXPIRED") return PASS_EXPIRED_MESSAGE;
    if (err.code === "PASSWORD_TOO_SHORT") {
      return passwordMessage("too_short", "single_factor");
    }
    if (err.code === "PASSWORD_BREACHED") return BREACHED_PASSWORD_MESSAGE;
    if (closesTwoStep(err)) return TWO_STEP_CLOSED_MESSAGE;
    if (err.code === "RATE_LIMITED") {
      return "Too many attempts. Please wait a few minutes and try again.";
    }
    return "Something went wrong. Please try again.";
  }
  // fetch rejects with a TypeError when the request never reached the
  // server; that has no account meaning, so naming it leaks nothing.
  if (err instanceof TypeError) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}
