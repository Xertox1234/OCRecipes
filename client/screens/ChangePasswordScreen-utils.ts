import { ApiError } from "@/lib/api-error";
import { errorBody } from "@/lib/second-factor-utils";
import type { SocialProvider } from "@shared/types/auth";

export type ForgotOption =
  | { kind: "provider"; provider: SocialProvider; label: string }
  | { kind: "email"; label: string };

const PROVIDER_ORDER: readonly SocialProvider[] = ["google", "apple"];
const PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: "Confirm with Google",
  apple: "Confirm with Apple",
};

/** "I forgot it": the connected Google/Apple sign-ins, then the emailed code. */
export function forgotOptions(
  providers: readonly SocialProvider[],
): ForgotOption[] {
  return [
    ...PROVIDER_ORDER.filter((p) => providers.includes(p)).map(
      (provider): ForgotOption => ({
        kind: "provider",
        provider,
        label: PROVIDER_LABEL[provider],
      }),
    ),
    { kind: "email", label: "Email me a code" },
  ];
}

/** Plain-words message for a failed change (change-password spec §3). */
export function changePasswordErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === "UNAUTHORIZED") return "That didn't match. Try again.";
  if (code === "INVALID_RESET_CODE")
    return "That code didn't work. Request a new one.";
  if (code === "TOKEN_REVOKED") return "Please sign in again.";
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_BREACHED") {
    const message = errorBody(err)?.error;
    if (typeof message === "string") return message;
  }
  if (err instanceof ApiError && err.status === 429)
    return "Too many attempts. Please try again later.";
  return "Something went wrong. Please try again.";
}

/**
 * Plain-words message for a failed "Email me a code". Two limits answer 429
 * — the daily cap ("…tomorrow") and the hourly burst limiter ("…wait") — so
 * show the one the server sent rather than assume the daily one.
 */
export function codeRequestErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError) || err.status !== 429)
    return "Couldn't send the code. Please try again.";
  const message = errorBody(err)?.error;
  return typeof message === "string"
    ? message
    : "Too many code requests. Please wait a while and try again.";
}
