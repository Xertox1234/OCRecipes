import React, { createContext, useContext, ReactNode } from "react";
import {
  useAuth,
  type DeleteAccountProof,
  type ChangePasswordProof,
  type TwoStepSecret,
} from "@/hooks/useAuth";
import type {
  MfaVerifyResult,
  SecondFactorInput,
  SessionResult,
  SignedInResult,
  SignInMethods,
  SocialProvider,
  SocialSignInResult,
  UpgradeRequiredResult,
  User,
} from "@shared/types/auth";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /**
   * On a 2FA account: `mfa_required` with a challenge, and nothing stored.
   * A password under 15 without two-step: `upgrade_required` with a pass.
   */
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
    newPassword?: string,
  ) => Promise<void>;
  replaceRecoveryCodes: (
    password: string,
    secondFactor: SecondFactorInput,
  ) => Promise<string[]>;
  forgetTrustedPhones: () => Promise<void>;
  /** A short password's pass (spec §6): stage an authenticator secret. */
  upgradeStartTwoStep: (pass: string) => Promise<TwoStepSecret>;
  /**
   * Returns the session WITHOUT signing in — save the codes, then finishSignIn.
   * No session when the server refused it after two-step went on: the codes
   * still come back, and the person signs in again.
   */
  upgradeConfirmTwoStep: (
    pass: string,
    code: string,
  ) => Promise<{ session?: SignedInResult; recoveryCodes: string[] }>;
  /** Sets a 15+ password on the pass and signs in. */
  upgradeSetPassword: (pass: string, newPassword: string) => Promise<void>;
  requestPasswordChangeCode: () => Promise<void>;
  changePassword: (
    proof: ChangePasswordProof,
    newPassword: string,
    secondFactor?: SecondFactorInput,
  ) => Promise<{ done: boolean; replacementRecoveryCode?: string }>;
  register: (
    username: string,
    password: string,
    email: string,
    ageConfirmed: boolean,
    twoStep?: boolean,
  ) => Promise<
    | { status: "authenticated"; user: User }
    | { status: "verification_pending" }
    | UpgradeRequiredResult
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
