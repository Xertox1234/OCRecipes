import { ApiError } from "@/lib/api-error";

// Two-step verification helpers shared by the challenge screen and the inline
// code fields (change email, delete account, connect a sign-in method).

/** Digits only, at most 6 — what an authenticator app shows. */
export function normalizeCodeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** The JSON body of a failed request (throwIfResNotOk: `${status}: ${body}`). */
function errorBody(err: unknown): Record<string, unknown> | undefined {
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

/**
 * Once a recovery code is spent, the server returns its replacement even when
 * the request then fails — read it so the person can still save it.
 */
export function replacementFromError(err: unknown): string | undefined {
  const value = errorBody(err)?.replacementRecoveryCode;
  return typeof value === "string" ? value : undefined;
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
