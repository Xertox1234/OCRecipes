export interface GoogleConfig {
  webClientId: string;
  appClientIds: string[];
}

export interface AppleConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
}

/** A provider is "configured" only when every var it needs is present. */
export function getSocialConfig(env: NodeJS.ProcessEnv = process.env): {
  google: GoogleConfig | null;
  apple: AppleConfig | null;
} {
  const appClientIds = (env.GOOGLE_OAUTH_APP_CLIENT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const google =
    env.GOOGLE_OAUTH_WEB_CLIENT_ID && appClientIds.length > 0
      ? { webClientId: env.GOOGLE_OAUTH_WEB_CLIENT_ID, appClientIds }
      : null;
  // IDENTITY_TOKEN_ENC_KEY is required too: without it we could not store the
  // Apple refresh token, and so could not revoke it at account deletion.
  const apple =
    env.APPLE_TEAM_ID &&
    env.APPLE_SIGN_IN_KEY_ID &&
    env.APPLE_SIGN_IN_PRIVATE_KEY &&
    env.APPLE_BUNDLE_ID &&
    env.IDENTITY_TOKEN_ENC_KEY
      ? {
          teamId: env.APPLE_TEAM_ID,
          keyId: env.APPLE_SIGN_IN_KEY_ID,
          privateKey: env.APPLE_SIGN_IN_PRIVATE_KEY.replace(/\\n/g, "\n"),
          bundleId: env.APPLE_BUNDLE_ID,
        }
      : null;
  return { google, apple };
}
