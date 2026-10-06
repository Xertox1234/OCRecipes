import React, { createContext, useContext, ReactNode } from "react";
import { useAuth, type DeleteAccountProof } from "@/hooks/useAuth";
import type {
  MfaProof,
  MfaVerifyResult,
  SessionResult,
  SignInMethods,
  SocialProvider,
  SocialSignInResult,
  User,
} from "@shared/types/auth";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** A 2FA account answers with a challenge; the caller opens MfaChallenge. */
  login: (username: string, password: string) => Promise<SessionResult>;
  register: (
    username: string,
    password: string,
    email: string,
    ageConfirmed: boolean,
  ) => Promise<
    { status: "authenticated"; user: User } | { status: "verification_pending" }
  >;
  logout: () => Promise<void>;
  expireSession: () => Promise<void>;
  /** False when the confirming provider sheet was cancelled (nothing deleted). */
  deleteAccount: (proof: DeleteAccountProof) => Promise<boolean>;
  updateUser: (updates: Partial<User>) => Promise<User | undefined>;
  changeEmail: (
    newEmail: string,
    password: string,
  ) => Promise<
    { status: "updated"; user: User } | { status: "verification_pending" }
  >;
  checkAuth: () => Promise<void>;
  signInWithProvider: (
    provider: SocialProvider,
  ) => Promise<SocialSignInResult | null>;
  completeSocialSignUp: (
    ticket: string,
    username: string,
    ageConfirmed: boolean,
  ) => Promise<void>;
  linkWithPassword: (
    ticket: string,
    password: string,
  ) => Promise<SessionResult>;
  /** Null when the provider sheet was cancelled. */
  linkWithProvider: (
    ticket: string,
    provider: SocialProvider,
  ) => Promise<SessionResult | null>;
  /** Null when the provider sheet was cancelled. */
  connectProvider: (
    provider: SocialProvider,
    password: string,
  ) => Promise<SignInMethods | null>;
  disconnectProvider: (provider: SocialProvider) => Promise<SignInMethods>;
  /** Check a two-step code; does NOT sign in (call finishSignIn). */
  verifySecondFactor: (
    challenge: string,
    proof: MfaProof,
  ) => Promise<MfaVerifyResult>;
  finishSignIn: (user: User, token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
