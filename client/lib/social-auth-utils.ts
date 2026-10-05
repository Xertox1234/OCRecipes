import type { SignInMethods, SocialProvider } from "@shared/types/auth";

/** Apple is iOS-only; on iOS Google never appears without Apple (App Store 4.8). */
export function visibleProviders(
  config: { google: boolean; apple: boolean },
  platform: "ios" | "android" | "web",
): SocialProvider[] {
  if (platform === "ios") {
    if (!config.apple) return [];
    return config.google ? ["apple", "google"] : ["apple"];
  }
  if (platform === "android") return config.google ? ["google"] : [];
  return [];
}

/** The server refuses to remove an account's last way to sign in; mirror it. */
export function canDisconnect(
  methods: SignInMethods,
  provider: SocialProvider,
): boolean {
  const count =
    Number(methods.password) +
    Number(methods.google !== null) +
    Number(methods.apple !== null);
  return methods[provider] !== null && count > 1;
}
