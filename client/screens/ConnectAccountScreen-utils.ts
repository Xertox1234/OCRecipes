import type { SignInMethod, SocialProvider } from "@shared/types/auth";
import { ApiError } from "@/lib/api-error";

export type ConnectPromptMode =
  | { kind: "password" }
  | { kind: "provider"; provider: SocialProvider }
  | { kind: "reset_only" };

/**
 * How the Connect prompt asks the person to prove they own the existing
 * account: its password if it has one, else a provider it is already linked
 * to that this device can open (Apple is iOS-only; Google needs its SDK in
 * this build), else only "Forgot password?" remains.
 */
export function connectPromptMode(
  methods: SignInMethod[],
  platform: "ios" | "android" | "web",
  nativeProviders: Readonly<Record<SocialProvider, boolean>>,
): ConnectPromptMode {
  if (methods.includes("password")) return { kind: "password" };
  const usable = methods.filter(
    (m): m is SocialProvider =>
      m !== "password" &&
      nativeProviders[m] &&
      (m !== "apple" || platform === "ios"),
  );
  return usable[0]
    ? { kind: "provider", provider: usable[0] }
    : { kind: "reset_only" };
}

/** What a failed submit on ChooseUsername / ConnectAccount should do. */
export type ScreenErrorOutcome =
  | { kind: "inline"; message: string }
  /** The ticket expired or was spent: toast and send them back to Login. */
  | { kind: "restart" };

const RESTART: ScreenErrorOutcome = { kind: "restart" };
const inline = (message: string): ScreenErrorOutcome => ({
  kind: "inline",
  message,
});

// Static copy only — branches on ApiError code/status, never error.message.
function codeOf(err: unknown): { code?: string; status?: number } {
  return err instanceof ApiError ? { code: err.code, status: err.status } : {};
}

export function connectErrorOutcome(err: unknown): ScreenErrorOutcome {
  const { code, status } = codeOf(err);
  if (code === "INVALID_SIGN_IN_TICKET") return RESTART;
  if (code === "SECOND_FACTOR_REQUIRED") {
    return inline(
      "This account uses two-step sign-in. Sign in with your password first, then connect from Settings.",
    );
  }
  if (code === "RATE_LIMITED" || status === 429) {
    return inline(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  }
  if (status === 401) return inline("Incorrect password. Please try again.");
  return inline("Something went wrong. Please try again.");
}

export function chooseUsernameErrorOutcome(err: unknown): ScreenErrorOutcome {
  const { code, status } = codeOf(err);
  if (code === "INVALID_SIGN_IN_TICKET") return RESTART;
  if (status === 409) return inline("That username is taken — try another.");
  if (code === "RATE_LIMITED" || status === 429) {
    return inline(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  }
  return inline("Something went wrong. Please try again.");
}
