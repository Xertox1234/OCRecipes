export interface GoogleSignInOptions {
  /** The web (server) client ID — becomes the ID token's `aud`. */
  webClientId: string;
  /** Required on iOS; ignored on Android. */
  iosClientId?: string;
  /** Passed to Google verbatim; callers pass the server's nonceHash. */
  nonce: string;
}

export interface GoogleSignInResult {
  idToken: string;
  email: string | null;
}

export type GoogleSignInErrorCode =
  | "NO_ACCOUNT"
  | "PLAY_SERVICES"
  | "NOT_CONFIGURED"
  | "FAILED";

export type GoogleSignInError = Error & { code: GoogleSignInErrorCode };
