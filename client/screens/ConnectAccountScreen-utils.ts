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
  /** The ticket can't be used any more: toast `message`, back to Login. */
  | { kind: "restart"; message: string };

const RESTART: ScreenErrorOutcome = {
  kind: "restart",
  message: "That took too long — please start again.",
};
const inline = (message: string): ScreenErrorOutcome => ({
  kind: "inline",
  message,
});

// Static copy only — branches on ApiError code/status, never error.message.
function codeOf(err: unknown): { code?: string; status?: number } {
  return err instanceof ApiError ? { code: err.code, status: err.status } : {};
}

// A link ticket also dies after 5 wrong passwords (same code as expiry), so
// this copy must not blame the clock.
const CONNECT_RESTART: ScreenErrorOutcome = {
  kind: "restart",
  message: "That sign-in can't be finished — please start again.",
};

export function connectErrorOutcome(
  err: unknown,
  mode: "password" | "provider",
): ScreenErrorOutcome {
  const { code, status } = codeOf(err);
  if (code === "INVALID_SIGN_IN_TICKET") return CONNECT_RESTART;
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
  // Provider mode answers UNAUTHORIZED when the Apple ID isn't the one linked
  // to this account; only password mode's UNAUTHORIZED is a wrong password.
  if (
    code === "INVALID_PROVIDER_TOKEN" ||
    (code === "UNAUTHORIZED" && mode === "provider")
  ) {
    return inline("That sign-in couldn't be confirmed. Please try again.");
  }
  if (code === "UNAUTHORIZED") {
    return inline("Incorrect password. Please try again.");
  }
  return inline("Something went wrong. Please try again.");
}

export function chooseUsernameErrorOutcome(err: unknown): ScreenErrorOutcome {
  const { code, status } = codeOf(err);
  if (code === "INVALID_SIGN_IN_TICKET") return RESTART;
  // The email got an account after this sign-in started; signing in again
  // now lands on the Connect prompt instead.
  if (code === "EMAIL_IN_USE") {
    return {
      kind: "restart",
      message:
        "An account with this email already exists. Sign in again to connect it.",
    };
  }
  if (status === 409) return inline("That username is taken — try another.");
  if (code === "RATE_LIMITED" || status === 429) {
    return inline(
      "Too many attempts. Please wait a few minutes and try again.",
    );
  }
  return inline("Something went wrong. Please try again.");
}
