import React, { createContext, useContext, ReactNode } from "react";
import {
  useAuth,
  type DeleteAccountProof,
  type TwoStepSecret,
} from "@/hooks/useAuth";
import type {
  MfaVerifyResult,
  SecondFactorInput,
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
  /** On a 2FA account: `mfa_required` with a challenge, and nothing stored. */
  login: (username: string, password: string) => Promise<SessionResult>;
  /** Answers a challenge; keeps a trust key but does not sign in (see finishSignIn). */
  verifySecondFactor: (
    challenge: string,
    proof: SecondFactorInput,
    trustDevice: boolean,
  ) => Promise<MfaVerifyResult>;
  finishSignIn: (user: User, token: string) => Promise<void>;
  startTwoStepSetup: (password: string) => Promise<TwoStepSecret>;
  startNewPhone: (
    password: string,
    secondFactor: SecondFactorInput,
  ) => Promise<TwoStepSecret & { replacementRecoveryCode?: string }>;
  confirmTwoStep: (code: string) => Promise<{ recoveryCodes?: string[] }>;
  disableTwoStep: (
    password: string,
    secondFactor: SecondFactorInput,
  ) => Promise<void>;
  replaceRecoveryCodes: (
    password: string,
    secondFactor: SecondFactorInput,
  ) => Promise<string[]>;
  forgetTrustedPhones: () => Promise<void>;
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
  deleteAccount: (
    proof: DeleteAccountProof,
    secondFactor?: SecondFactorInput,
  ) => Promise<boolean>;
  updateUser: (updates: Partial<User>) => Promise<User | undefined>;
  changeEmail: (
    newEmail: string,
    password: string,
    secondFactor?: SecondFactorInput,
  ) => Promise<
    ({ status: "updated"; user: User } | { status: "verification_pending" }) & {
      replacementRecoveryCode?: string;
    }
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
  linkWithProvider: (ticket: string, provider: SocialProvider) => Promise<void>;
  /** Null when the provider sheet was cancelled. */
  connectProvider: (
    provider: SocialProvider,
    password: string,
    secondFactor?: SecondFactorInput,
  ) => Promise<{
    signInMethods: SignInMethods;
    replacementRecoveryCode?: string;
  } | null>;
  disconnectProvider: (provider: SocialProvider) => Promise<SignInMethods>;
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
