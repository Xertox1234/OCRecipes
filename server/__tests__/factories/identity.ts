import type { PendingSocialSignIn, UserIdentity } from "@shared/schema";

const identityDefaults: UserIdentity = {
  id: "identity-1",
  userId: "1",
  provider: "google",
  providerSubject: "g-1",
  email: null,
  isPrivateRelay: false,
  appleRefreshTokenEnc: null,
  createdAt: new Date("2024-01-01"),
  lastUsedAt: null,
};

export function createMockUserIdentity(
  overrides: Partial<UserIdentity> = {},
): UserIdentity {
  return { ...identityDefaults, ...overrides };
}

const pendingDefaults: PendingSocialSignIn = {
  ticketHash: "ticket-hash",
  kind: "link",
  provider: "google",
  providerSubject: "g-1",
  email: "me@example.com",
  isPrivateRelay: false,
  providerAuthoritative: false,
  emailVerified: true,
  displayName: null,
  appleRefreshTokenEnc: null,
  targetUserId: "1",
  attempts: 0,
  expiresAt: new Date("2099-01-01"),
};

export function createMockPendingSocialSignIn(
  overrides: Partial<PendingSocialSignIn> = {},
): PendingSocialSignIn {
  return { ...pendingDefaults, ...overrides };
}
