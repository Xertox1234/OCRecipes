import type { ProviderClaims, SignInMethod } from "./types";

export interface PolicyAccount {
  id: string;
  email: string;
  emailVerified: boolean;
  hasSecondFactor: boolean;
  methods: SignInMethod[];
}

export type LinkDecision =
  | { kind: "sign_in"; userId: string }
  | { kind: "choose_username" }
  | { kind: "auto_link"; userId: string }
  | { kind: "link_required"; userId: string; methods: SignInMethod[] };

export function normaliseEmail(e: string): string {
  return e.trim().toLowerCase();
}

// Google's "Verify the Google ID token" guide: Google is authoritative for
// gmail addresses, or Workspace (hd set) with email_verified. Elsewhere,
// email_verified only meant "verified at account creation".
const GOOGLE_CONSUMER_DOMAINS = ["@gmail.com", "@googlemail.com"];

export function isAuthoritative(c: ProviderClaims): boolean {
  if (!c.email) return false;
  const email = normaliseEmail(c.email);
  if (c.provider === "google") {
    if (GOOGLE_CONSUMER_DOMAINS.some((d) => email.endsWith(d))) return true;
    return c.emailVerified && Boolean(c.hostedDomain);
  }
  return c.emailVerified && !c.isPrivateRelay;
}

/** Spec §4.3 — precedence matters: already-linked wins, auto-link needs EVERY condition. */
export function decideLink(input: {
  claims: ProviderClaims;
  linkedUserId: string | null;
  emailAccount: PolicyAccount | null;
}): LinkDecision {
  const { claims, linkedUserId, emailAccount } = input;
  if (linkedUserId) return { kind: "sign_in", userId: linkedUserId };
  if (!emailAccount) return { kind: "choose_username" };
  const sameAddress =
    claims.email !== null &&
    normaliseEmail(claims.email) === normaliseEmail(emailAccount.email);
  if (
    !emailAccount.hasSecondFactor &&
    emailAccount.emailVerified &&
    sameAddress &&
    isAuthoritative(claims)
  ) {
    return { kind: "auto_link", userId: emailAccount.id };
  }
  return {
    kind: "link_required",
    userId: emailAccount.id,
    methods: emailAccount.methods,
  };
}
