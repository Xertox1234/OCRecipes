import { ApiError } from "@/lib/api-error";
import type { MfaChallengeResult } from "@shared/types/auth";

// Two-step verification helpers shared by the challenge screen and the inline
// code fields (change email, delete account, connect a sign-in method).

/** A password-proof form refused because its password field is empty. */
export const ENTER_PASSWORD = "Enter your password.";

/** A password form refused because its two-step code field is still empty. */
export const ENTER_TWO_STEP_CODE = "Enter the two-step code we email you.";

/** Digits only, at most 6 — the emailed code. */
export function normalizeCodeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** The JSON body of a failed request (throwIfResNotOk: `${status}: ${body}`). */
export function errorBody(err: unknown): Record<string, unknown> | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const sep = err.message.indexOf(": ");
  if (sep < 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(err.message.slice(sep + 2));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A password proof on a 2FA account needs the code as well. */
export function isSecondFactorRequired(err: unknown): boolean {
  return err instanceof ApiError && err.code === "SECOND_FACTOR_REQUIRED";
}

const TWO_STEP_CHECK_CODES = new Set([
  "INVALID_SECOND_FACTOR",
  "MFA_UNAVAILABLE",
  "RATE_LIMITED",
]);

/** A failure about the code itself — show secondFactorErrorMessage's copy. */
export function isTwoStepCheckError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.code !== undefined &&
    TWO_STEP_CHECK_CODES.has(err.code)
  );
}

export function secondFactorErrorMessage(err: unknown): {
  message: string;
  restart: boolean;
} {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === "MFA_CHALLENGE_EXPIRED") {
    return {
      message: "This sign-in expired. Please start again.",
      restart: true,
    };
  }
  if (code === "INVALID_SECOND_FACTOR") {
    const message = errorBody(err)?.error;
    return {
      message:
        typeof message === "string"
          ? message
          : "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
      restart: false,
    };
  }
  if (code === "MFA_UNAVAILABLE") {
    return {
      message:
        "Two-step verification is unavailable right now. Please try again later.",
      restart: false,
    };
  }
  if (
    code === "RATE_LIMITED" ||
    (err instanceof ApiError && err.status === 429)
  ) {
    return {
      message: "Too many attempts. Please wait a few minutes and try again.",
      restart: false,
    };
  }
  return {
    message: "Couldn't check that code. Please try again.",
    restart: false,
  };
}

/**
 * How a re-authentication dialog (change email, delete account) words the
 * failures they share: the second-factor branch and a wrong password. Returns
 * null for any other error, which the dialog words itself.
 * `needsCode` — right password on a 2FA account: keep it and ask for the code.
 */
export function mapReauthError(
  err: unknown,
): { message: string; needsCode: boolean; wrongPassword: boolean } | null {
  if (isSecondFactorRequired(err)) {
    return {
      message: "Enter the code we email you.",
      needsCode: true,
      wrongPassword: false,
    };
  }
  if (isTwoStepCheckError(err)) {
    return {
      message: secondFactorErrorMessage(err).message,
      needsCode: false,
      wrongPassword: false,
    };
  }
  if (err instanceof Error && /Invalid credentials/i.test(err.message)) {
    return {
      message: "Incorrect password. Please try again.",
      needsCode: false,
      wrongPassword: true,
    };
  }
  return null;
}

/** The "Email me a code" button on an email two-step account. */
export function emailCodeButtonLabel(
  sent: boolean,
  secondsLeft: number,
): string {
  if (!sent) return "Email me a code";
  return secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code";
}

/** A failed "Email me a code" — static copy, never the raw response. */
export function emailCodeSendError(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === "MFA_EMAIL_DAILY_LIMIT")
    return "Too many codes today. Use the newest one in your email, or try again tomorrow.";
  if (code === "MFA_CHALLENGE_EXPIRED")
    return "This sign-in expired. Please start again.";
  if (
    code === "RATE_LIMITED" ||
    (err instanceof ApiError && err.status === 429)
  )
    return "Wait a moment before asking for another code.";
  return "Couldn't send a code. Please try again.";
}

/** The code screen's params from a sign-in (or connect) challenge. */
export function twoStepCodeParams(
  result: MfaChallengeResult,
  purpose: "login" | "link",
) {
  return {
    challenge: result.challenge,
    purpose,
    emailHint: result.emailHint,
    codeSent: result.codeSent,
  };
}
