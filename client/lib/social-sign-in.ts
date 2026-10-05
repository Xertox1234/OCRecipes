// Native provider sheets only — the server verifies everything they return.
import * as AppleAuthentication from "expo-apple-authentication";
import type { SocialProvider } from "@shared/types/auth";

export interface ProviderToken {
  idToken: string;
  authorizationCode?: string;
  fullName?: { givenName: string | null; familyName: string | null };
}

/**
 * Which provider SDKs this build ships. Owner ruling 2026-10-05: Apple first;
 * the Google SDK (paid Universal Sign In) lands later, so Google stays hidden
 * even when the server reports it configured.
 */
export const NATIVE_PROVIDERS: Readonly<Record<SocialProvider, boolean>> = {
  apple: true,
  google: false,
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
  if (provider !== "apple") {
    throw new Error(`${provider} sign-in is not available in this version`);
  }
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
