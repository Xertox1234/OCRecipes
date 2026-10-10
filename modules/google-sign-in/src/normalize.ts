import type { GoogleSignInError, GoogleSignInErrorCode } from "./types";

const KNOWN: readonly GoogleSignInErrorCode[] = [
  "NO_ACCOUNT",
  "PLAY_SERVICES",
  "NOT_CONFIGURED",
  "FAILED",
];

/** Any native rejection → an Error whose `code` is one of ours (else FAILED). */
export function toGoogleSignInError(err: unknown): GoogleSignInError {
  const raw = (err as { code?: unknown } | null)?.code;
  const code = KNOWN.includes(raw as GoogleSignInErrorCode)
    ? (raw as GoogleSignInErrorCode)
    : "FAILED";
  const message = err instanceof Error ? err.message : String(err);
  return Object.assign(new Error(message), { code });
}
