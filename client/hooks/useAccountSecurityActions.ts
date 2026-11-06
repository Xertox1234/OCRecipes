import { useCallback } from "react";
import { apiRequest } from "@/lib/query-client";
import { tokenStorage, trustKeyStorage } from "@/lib/token-storage";
import type {
  SecondFactorInput,
  SignedInResult,
  SignInMethods,
  SocialProvider,
  User,
  EmailCodeSent,
} from "@shared/types/auth";
import { getProviderToken } from "@/lib/social-sign-in";
import { fetchNonce } from "./auth-session";

export type DeleteAccountProof =
  | { password: string }
  | { provider: SocialProvider };

export type ChangePasswordProof =
  | { password: string }
  | { provider: SocialProvider }
  | { emailCode: string };

/**
 * The signed-in account's security settings for useAuth: Google/Apple
 * connections, two-step verification, trusted phones and password change.
 * None of them read the auth state; the ones that end with a new session for
 * this phone store it through `establishSession`.
 */
export function useAccountSecurityActions(
  establishSession: (user: User, token: string) => Promise<void>,
) {
  /**
   * Add a Google/Apple sign-in to the signed-in account. The server wants the
   * password as proof (owner ruling: same bar as deleting the account) and a
   * link nonce bound to this session. Resolves null when the sheet is
   * cancelled; otherwise the account's updated sign-in methods.
   */
  const connectProvider = useCallback(
    async (
      provider: SocialProvider,
      password: string,
      secondFactor?: SecondFactorInput,
    ): Promise<{ signInMethods: SignInMethods } | null> => {
      const { nonce, nonceHash } = await fetchNonce("link");
      const token = await getProviderToken(provider, nonceHash);
      if (!token) return null;
      const res = await apiRequest("POST", "/api/auth/identities", {
        provider,
        nonce,
        idToken: token.idToken,
        // Apple: exchanged server-side for the refresh token that account
        // deletion revokes.
        authorizationCode: token.authorizationCode,
        proof: { password, ...(secondFactor ? { secondFactor } : {}) },
      });
      return (await res.json()) as { signInMethods: SignInMethods };
    },
    [],
  );

  const disconnectProvider = useCallback(
    async (provider: SocialProvider): Promise<SignInMethods> => {
      const res = await apiRequest(
        "DELETE",
        `/api/auth/identities/${provider}`,
      );
      return ((await res.json()) as { signInMethods: SignInMethods })
        .signInMethods;
    },
    [],
  );

  // ── Two-step verification (Profile → Sign-in methods) ──────────────────
  /** Turn two-step off. Every device was signed out; keep this one. */
  const disableTwoStep = useCallback(
    async (password: string, secondFactor: SecondFactorInput) => {
      const res = await apiRequest("POST", "/api/auth/mfa/disable", {
        password,
        secondFactor,
      });
      const data = (await res.json()) as SignedInResult;
      await establishSession(data.user, data.token);
    },
    [establishSession],
  );

  /** Password → a code emailed to the account's address. */
  const startEmailTwoStep = useCallback(
    async (password: string): Promise<EmailCodeSent> => {
      const res = await apiRequest("POST", "/api/auth/mfa/email/setup", {
        password,
      });
      return (await res.json()) as EmailCodeSent;
    },
    [],
  );

  /** The emailed code turns two-step on. Other devices were signed out; keep this one. */
  const confirmEmailTwoStep = useCallback(
    async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/mfa/email/confirm", {
        code,
      });
      const data = (await res.json()) as SignedInResult;
      await establishSession(data.user, data.token);
    },
    [establishSession],
  );

  /** "Resend code" on the sign-in code screen (no session yet). */
  const resendSignInCode = useCallback(
    async (challenge: string): Promise<EmailCodeSent> => {
      const res = await apiRequest("POST", "/api/auth/mfa/email/resend", {
        challenge,
      });
      return (await res.json()) as EmailCodeSent;
    },
    [],
  );

  /** Every trusted phone asks for the code again — this one included. */
  const forgetTrustedPhones = useCallback(async () => {
    await apiRequest("DELETE", "/api/auth/mfa/trusted-devices");
    await trustKeyStorage.clear();
  }, []);

  /** Email a code for a signed-in password change ("I forgot it"). */
  const requestPasswordChangeCode = useCallback(async () => {
    await apiRequest("POST", "/api/auth/change-password/code", {});
  }, []);

  /**
   * Set a new password while signed in (change-password spec §5). The server
   * signs every other device out and answers with a session for this phone;
   * it is stored only if no one else signed in here meanwhile (auth audit L7).
   * Resolves done:false only when the Google/Apple sheet was cancelled.
   */
  const changePassword = useCallback(
    async (
      proof: ChangePasswordProof,
      newPassword: string,
      secondFactor?: SecondFactorInput,
    ): Promise<{ done: boolean }> => {
      const before = await tokenStorage.get();
      let body: object;
      if ("provider" in proof) {
        const { nonce, nonceHash } = await fetchNonce("reauth");
        const token = await getProviderToken(proof.provider, nonceHash);
        if (!token) return { done: false };
        body = {
          proof: { provider: proof.provider, nonce, idToken: token.idToken },
          newPassword,
        };
      } else {
        const withFactor = secondFactor ? { ...proof, secondFactor } : proof;
        body = { proof: withFactor, newPassword };
      }
      const res = await apiRequest("POST", "/api/auth/change-password", body);
      const data = (await res.json()) as SignedInResult;
      // A late reply never replaces a newer sign-in on this phone; the
      // password change itself stands.
      if ((await tokenStorage.get()) === before) {
        await establishSession(data.user, data.token);
      }
      return { done: true };
    },
    [establishSession],
  );

  return {
    connectProvider,
    disconnectProvider,
    disableTwoStep,
    startEmailTwoStep,
    confirmEmailTwoStep,
    resendSignInCode,
    forgetTrustedPhones,
    requestPasswordChangeCode,
    changePassword,
  };
}
