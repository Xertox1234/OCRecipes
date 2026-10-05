import type {
  SignInMethod,
  SignInMethods,
  SocialProvider,
} from "@shared/types/auth";
import { ApiError } from "@/lib/api-error";
import { canDisconnect } from "@/lib/social-auth-utils";
import {
  connectPromptMode,
  type ConnectPromptMode,
} from "./ConnectAccountScreen-utils";

type Platform = "ios" | "android" | "web";
type NativeProviders = Readonly<Record<SocialProvider, boolean>>;

/** Row subtitle for a provider; Apple relay addresses are never shown. */
export function methodSubtitle(
  identity: { email: string | null; isPrivateRelay?: boolean } | null,
): string {
  if (!identity) return "Not connected";
  if (identity.isPrivateRelay) return "Hidden by Apple";
  return identity.email ?? "Connected";
}

export function toMethodList(methods: SignInMethods): SignInMethod[] {
  const list: SignInMethod[] = [];
  if (methods.password) list.push("password");
  if (methods.google) list.push("google");
  if (methods.apple) list.push("apple");
  return list;
}

export type ProviderRowState =
  | { kind: "hidden" }
  | { kind: "connect" }
  | { kind: "connect_blocked"; hint: string }
  | { kind: "disconnect"; enabled: true }
  | { kind: "disconnect"; enabled: false; hint: string };

/**
 * What a provider's row offers. A linked provider always shows (so it can be
 * disconnected); an unlinked one only when this device can open it. Connecting
 * is confirmed with the password (owner ruling: adding a sign-in method needs
 * re-auth), so without one the row explains how to add it.
 */
export function providerRowState(
  methods: SignInMethods,
  provider: SocialProvider,
  platform: Platform,
  nativeProviders: NativeProviders,
): ProviderRowState {
  if (methods[provider]) {
    return canDisconnect(methods, provider)
      ? { kind: "disconnect", enabled: true }
      : {
          kind: "disconnect",
          enabled: false,
          hint: "Add a password or another sign-in method first.",
        };
  }
  const openable =
    nativeProviders[provider] && (provider !== "apple" || platform === "ios");
  if (!openable) return { kind: "hidden" };
  return methods.password
    ? { kind: "connect" }
    : {
        kind: "connect_blocked",
        hint: "Set up a password first, then you can connect this.",
      };
}

// Static copy only — branches on ApiError code/status, never error.message.
export function identityErrorMessage(err: unknown): string {
  const { code, status } =
    err instanceof ApiError ? { code: err.code, status: err.status } : {};
  if (code === "IDENTITY_IN_USE") {
    return "That sign-in is already used by another OCRecipes account.";
  }
  if (code === "PROVIDER_ALREADY_CONNECTED") return "It's already connected.";
  if (code === "LAST_SIGN_IN_METHOD") {
    return "Add a password or another sign-in method first.";
  }
  if (code === "RATE_LIMITED" || status === 429) {
    return "Too many attempts. Please wait a while and try again.";
  }
  if (status === 401) return "Incorrect password. Please try again.";
  return "Something went wrong. Please try again.";
}

/** How the delete-account modal asks the person to prove it's them. */
export type DeleteProofMode = { kind: "loading" } | ConnectPromptMode;

export function deleteProofMode(
  methods: SignInMethods | undefined,
  platform: Platform,
  nativeProviders: NativeProviders,
): DeleteProofMode {
  if (!methods) return { kind: "loading" };
  return connectPromptMode(toMethodList(methods), platform, nativeProviders);
}
