// Our own bridge to Google's official sign-in SDKs (spec 2026-10-09).
// One function: open Google's sheet with the server's nonce hash, return the
// ID token. The server verifies everything.
import { requireNativeModule } from "expo";

import { toGoogleSignInError } from "./src/normalize";
import type { GoogleSignInOptions, GoogleSignInResult } from "./src/types";

export type {
  GoogleSignInError,
  GoogleSignInErrorCode,
  GoogleSignInOptions,
  GoogleSignInResult,
} from "./src/types";

const Native = requireNativeModule<{
  signIn(options: GoogleSignInOptions): Promise<GoogleSignInResult | null>;
}>("OCRGoogleSignIn");

/** Resolves null when the person cancels; rejects with a coded Error. */
export async function signIn(
  options: GoogleSignInOptions,
): Promise<GoogleSignInResult | null> {
  try {
    return await Native.signIn(options);
  } catch (err) {
    throw toGoogleSignInError(err);
  }
}
