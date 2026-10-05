import type { SignInMethods, SocialProvider } from "@shared/types/auth";
import { ApiError } from "@/lib/api-error";

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

/**
 * Static copy for a failed Google/Apple sign-in. Branches on `ApiError.code`
 * only — never shows `error.message` (raw server body; no-error-message-in-ui).
 */
export function socialSignInErrorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : undefined;
  switch (code) {
    case "PROVIDER_EXCHANGE_FAILED":
      return "We couldn't finish signing you in with Apple. Please try again.";
    case "PROVIDER_EMAIL_REQUIRED":
      return "We need a verified email address from your account. Please try again and share your email, or sign up with a password.";
    case "EMAIL_NOT_VERIFIED":
      return "Please verify your email address first — check your inbox for the link.";
    case "SECOND_FACTOR_REQUIRED":
      return "This account uses two-step sign-in. Please sign in with your password.";
    case "RATE_LIMITED":
      return "Too many attempts. Please wait a few minutes and try again.";
    default:
      return "Sign-in didn't work. Please try again.";
  }
}
