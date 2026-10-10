// Native provider sheets only — the server verifies everything they return.
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import type { SocialProvider } from "@shared/types/auth";

import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from "@/constants/google-oauth";
import { reportError } from "@/lib/reporter";
import * as GoogleSignIn from "../../modules/google-sign-in";

export interface ProviderToken {
  idToken: string;
  authorizationCode?: string;
  fullName?: { givenName: string | null; familyName: string | null };
}

/**
 * Google needs the web client ID everywhere and, on iOS, the iOS client ID
 * (Android matches its client by package + SHA-1). No Google on web.
 */
export function isGoogleAvailable(
  os: string,
  webClientId: string,
  iosClientId: string,
): boolean {
  if (!webClientId) return false;
  if (os === "ios") return iosClientId.length > 0;
  return os === "android";
}

/** Which provider SDKs this build ships. */
export const NATIVE_PROVIDERS: Readonly<Record<SocialProvider, boolean>> = {
  apple: true,
  google: isGoogleAvailable(
    Platform.OS,
    GOOGLE_WEB_CLIENT_ID,
    GOOGLE_IOS_CLIENT_ID,
  ),
};

/**
 * Opens the provider's sheet with the server's nonce HASH (the ID token then
 * carries it; the server checks it against sha256 of the raw nonce). Returns
 * null when the person cancels — callers show nothing.
 */
export async function getProviderToken(
  provider: SocialProvider,
  nonceHash: string,
): Promise<ProviderToken | null> {
  if (provider === "google") return getGoogleToken(nonceHash);
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      // expo-apple-authentication passes this through unhashed (verified
      // 2026-10-04), so Apple's token carries exactly nonceHash.
      nonce: nonceHash,
    });
    if (!cred.identityToken)
      throw new Error("Apple returned no identity token");
    return {
      idToken: cred.identityToken,
      authorizationCode: cred.authorizationCode ?? undefined,
      fullName: cred.fullName
        ? {
            givenName: cred.fullName.givenName,
            familyName: cred.fullName.familyName,
          }
        : undefined,
    };
  } catch (err) {
    if ((err as { code?: string }).code === "ERR_REQUEST_CANCELED") return null;
    throw err;
  }
}

async function getGoogleToken(
  nonceHash: string,
): Promise<ProviderToken | null> {
  try {
    const result = await GoogleSignIn.signIn({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID,
      // Passed through unhashed, like Apple's: the token's nonce claim is
      // nonceHash and the server checks it against sha256(raw nonce).
      nonce: nonceHash,
    });
    return result ? { idToken: result.idToken } : null;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "FAILED";
    reportError(err, `google-sign-in:${code}`);
    throw err;
  }
}
