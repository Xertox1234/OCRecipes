// Google OAuth client IDs. Public identifiers, not secrets: the reversed iOS
// one is also committed in ios/OCRecipes/Info.plist (kept in step by
// native-config.test.ts). Committed constants, not EXPO_PUBLIC_* env, so a
// missed build profile can't silently hide the button (spec 2026-10-09 §3.4).
// The Android client ID is never used here — Credential Manager matches it by
// package name + signing SHA-1.

/** The server's client — the ID token's `aud`. */
export const GOOGLE_WEB_CLIENT_ID =
  "302305066915-it2i5q9mo9a8086b940jke4nhbev6bom.apps.googleusercontent.com";

/** The iOS app's client — the ID token's `azp` on iOS. */
export const GOOGLE_IOS_CLIENT_ID =
  "302305066915-i735f5tb3i1udb23fduorkuludvgp8cr.apps.googleusercontent.com";

const SUFFIX = ".apps.googleusercontent.com";

/** `<prefix>.apps.googleusercontent.com` → `com.googleusercontent.apps.<prefix>`. */
export function reversedIosClientId(id: string): string {
  return `com.googleusercontent.apps.${id.slice(0, -SUFFIX.length)}`;
}
