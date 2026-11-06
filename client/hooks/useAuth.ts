import { useState, useEffect, useCallback, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "@/lib/query-client";
import {
  tokenStorage,
  trustKeyStorage,
  pendingRevokeStorage,
} from "@/lib/token-storage";
import { logger } from "@/lib/logger";
import { sendDeviceTimezoneOnce } from "@/lib/timezone";
import type {
  MfaChallengeResult,
  MfaVerifyResult,
  SecondFactorInput,
  SessionResult,
  SocialProvider,
  SocialSignInResult,
  User,
} from "@shared/types/auth";
import { isUser } from "@shared/types/auth";
import { getProviderToken } from "@/lib/social-sign-in";
import {
  registerPushToken,
  unregisterPushToken,
} from "@/lib/push-token-registration";
import { usePushTokenRotation } from "./usePushTokenRotation";
import { AUTH_STORAGE_KEY } from "@/lib/durable-owner";
import {
  type AuthState,
  clearDurableLocalState,
  dropPendingRevokeFor,
  fetchNonce,
  reconcileOwnerFor,
  retryPendingRevoke,
  runAuthCheck,
  withSignInExclusion,
} from "./auth-session";
import {
  type DeleteAccountProof,
  useAccountSecurityActions,
} from "./useAccountSecurityActions";

export { AUTH_ME_TIMEOUT_MS } from "./auth-session";
export type {
  DeleteAccountProof,
  ChangePasswordProof,
} from "./useAccountSecurityActions";

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const checkAuth = useCallback(() => runAuthCheck(setState), []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // Daily quotas reset at the user's local midnight once the server knows the
  // phone's timezone. Fire-and-forget after the session is established (keyed
  // on the user id, so it runs once per sign-in / launch, never blocks either);
  // a local marker stops re-sends and a failure retries at the next launch.
  const signedInUserId = state.user?.id;
  useEffect(() => {
    if (signedInUserId === undefined) return;
    sendDeviceTimezoneOnce(String(signedInUserId)).catch(() => {});
  }, [signedInUserId]);

  // Retry a failed server logout once the session state is known (launch) and
  // whenever the signed-in user changes. The AppState listener below reads the
  // current user through the ref.
  const currentUserIdRef = useRef<string | undefined>(undefined);
  const isAuthLoading = state.isLoading;
  useEffect(() => {
    const userId =
      signedInUserId === undefined ? undefined : String(signedInUserId);
    currentUserIdRef.current = userId;
    if (isAuthLoading) return;
    void retryPendingRevoke(userId);
  }, [isAuthLoading, signedInUserId]);

  // Re-validate auth when the app returns to the foreground, so a session that
  // expired (or was revoked) while backgrounded is caught on resume rather than
  // surfacing as a stale-looking failure on the next user action.
  //
  // A `hasBeenBackgrounded` latch — not a "previous === active" check — is the
  // correct cross-platform guard. iOS resumes via `background → inactive →
  // active` (two events), so a `prev === "background"` check would miss it; and
  // both the spurious mount-time `active` (common on Android) and iOS
  // `active → inactive → active` churn (control center, notification shade)
  // must NOT trigger a re-check. The latch only fires after a real background.
  // The in-flight guard collapses rapid app-switching into a single re-check.
  useEffect(() => {
    let hasBeenBackgrounded = false;
    let recheckInFlight = false;
    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "background") {
          hasBeenBackgrounded = true;
          return;
        }
        if (nextState === "active" && hasBeenBackgrounded && !recheckInFlight) {
          hasBeenBackgrounded = false;
          recheckInFlight = true;
          void checkAuth().finally(() => {
            recheckInFlight = false;
            void retryPendingRevoke(currentUserIdRef.current);
          });
        }
      },
    );
    return () => subscription.remove();
  }, [checkAuth]);

  // While signed in, re-send a push token the platform rotates at runtime.
  const stopPushRotation = usePushTokenRotation(state.isAuthenticated);

  // Shared by every path that ends with a session token (password login and
  // each Google/Apple path).
  const establishSession = useCallback(async (user: User, token: string) => {
    // Before the new token exists: a pending revoke for this same user would
    // end the session being created.
    await dropPendingRevokeFor(user.id);
    await tokenStorage.set(token);
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    // The root-cause fix: login() historically cleared NO durable local state, so
    // a different user signing in on a shared device inherited the prior user's
    // global-keyed history/queue/cache. Reconcile here wipes them on a mismatch
    // before the app renders authenticated surfaces.
    await reconcileOwnerFor(user.id);
    setState({ user, isLoading: false, isAuthenticated: true });
    // Register push token after sign-in (fire-and-forget, non-fatal)
    registerPushToken().catch(() => {});
  }, []);

  /**
   * Password sign-in. On a 2FA account the server answers with a challenge
   * instead of a session (unless this phone is trusted): the caller routes to
   * the code screen, and nothing is stored until the code passes.
   */
  const login = useCallback(
    async (username: string, password: string): Promise<SessionResult> =>
      withSignInExclusion(async () => {
        const trustKey = await trustKeyStorage.get();
        const response = await apiRequest("POST", "/api/auth/login", {
          username,
          password,
          ...(trustKey ? { trustKey } : {}),
        });
        const data = (await response.json()) as
          | MfaChallengeResult
          | { user: User; token: string };
        if ("status" in data) return data;
        const { user, token } = data as { user: User; token: string };
        await establishSession(user, token);
        return { status: "signed_in", user, token };
      }),
    [establishSession],
  );

  /**
   * Answer a two-step challenge. Keeps a returned "trust this phone" key but
   * does NOT sign in: the screen calls finishSignIn.
   */
  const verifySecondFactor = useCallback(
    async (
      challenge: string,
      proof: SecondFactorInput,
      trustDevice: boolean,
    ): Promise<MfaVerifyResult> =>
      withSignInExclusion(async () => {
        const res = await apiRequest("POST", "/api/auth/mfa/verify", {
          challenge,
          secondFactor: proof,
          trustDevice,
        });
        const result = (await res.json()) as MfaVerifyResult;
        if (result.trustKey) await trustKeyStorage.set(result.trustKey);
        // The session token exists now; finishSignIn runs outside this
        // exclusion, so drop this user's record before a retry could send it.
        await dropPendingRevokeFor(result.user.id);
        return result;
      }),
    [],
  );

  // ── Sign in with Apple (Google later) ──────────────────────────────────
  // The provider sheet gets the nonce HASH; the server gets the raw nonce and
  // checks the token's nonce claim against sha256(raw). Returns null when the
  // person cancels the sheet.
  const signInWithProvider = useCallback(
    async (provider: SocialProvider): Promise<SocialSignInResult | null> =>
      withSignInExclusion(async () => {
        const { nonce, nonceHash } = await fetchNonce("sign_in");
        const token = await getProviderToken(provider, nonceHash);
        if (!token) return null;
        const res = await apiRequest("POST", "/api/auth/social", {
          provider,
          nonce,
          ...token,
        });
        const result = (await res.json()) as SocialSignInResult;
        if (result.status === "signed_in") {
          await establishSession(result.user, result.token);
        }
        return result;
      }),
    [establishSession],
  );

  const completeSocialSignUp = useCallback(
    async (ticket: string, username: string, ageConfirmed: boolean) =>
      withSignInExclusion(async () => {
        const res = await apiRequest(
          "POST",
          "/api/auth/social/complete-sign-up",
          // COPPA 13+ attestation — the person's actual checkbox state.
          { ticket, username, ageConfirmed },
        );
        const { user, token } = await res.json();
        await establishSession(user, token);
      }),
    [establishSession],
  );

  /** The Connect prompt's password proof; a 2FA account answers with a challenge. */
  const linkWithPassword = useCallback(
    async (ticket: string, password: string): Promise<SessionResult> =>
      withSignInExclusion(async () => {
        const res = await apiRequest("POST", "/api/auth/social/link", {
          ticket,
          password,
        });
        const result = (await res.json()) as SessionResult;
        if (result.status === "signed_in") {
          await establishSession(result.user, result.token);
        }
        return result;
      }),
    [establishSession],
  );

  const linkWithProvider = useCallback(
    async (ticket: string, provider: SocialProvider) =>
      withSignInExclusion(async () => {
        const { nonce, nonceHash } = await fetchNonce("link");
        const token = await getProviderToken(provider, nonceHash);
        if (!token) return;
        const res = await apiRequest("POST", "/api/auth/social/link", {
          ticket,
          provider,
          nonce,
          idToken: token.idToken,
        });
        const { user, token: session } = await res.json();
        await establishSession(user, session);
      }),
    [establishSession],
  );

  const register = useCallback(
    async (
      username: string,
      password: string,
      email: string,
      ageConfirmed: boolean,
    ): Promise<
      | { status: "authenticated"; user: User }
      | { status: "verification_pending" }
    > => {
      const response = await apiRequest("POST", "/api/auth/register", {
        username,
        password,
        email,
        // COPPA 13+ age attestation — caller forwards user's actual checkbox
        // state; server enforces with `z.literal(true)` (zero trust on client).
        ageConfirmed,
      });
      const data = await response.json();
      // Verification OFF (fail-open) → server returns a token → auto-login,
      // preserving the pre-feature behavior.
      if (data.token) {
        await dropPendingRevokeFor(data.user.id);
        await tokenStorage.set(data.token);
        await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
        // A freshly-registered user is, by definition, a different owner than any
        // prior account on this device — reconcile wipes residual durable state
        // before authenticated surfaces render.
        await reconcileOwnerFor(data.user.id);
        setState({ user: data.user, isLoading: false, isAuthenticated: true });
        // Register push token after registration (fire-and-forget, non-fatal)
        registerPushToken().catch(() => {});
        return { status: "authenticated", user: data.user };
      }
      // Verification ON → no token issued; the caller routes to the verify
      // screen. The user is NOT authenticated yet.
      return { status: "verification_pending" };
    },
    [],
  );

  const logout = useCallback(async () => {
    // Edge: if the token already expired, this POST 401s with a TOKEN_* code →
    // the global interceptor fires the session-expiry toast. Accepted by design
    // — the user is logging out anyway, so "session expired" then Login is benign.
    // Unregister this device's push token first: the logout POST revokes the
    // session token the DELETE needs (unregisterPushToken never throws). Stop
    // the rotation listener before that so it cannot re-register the token.
    stopPushRotation();
    await unregisterPushToken();
    // Read before the POST: if it fails, this token is kept for a later revoke.
    const revokeToken = await tokenStorage.get();
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch (error) {
      // Local sign-out still proceeds, but the server never revoked the token
      // (offline, 5xx): it stays usable until it expires. Make that visible,
      // and keep it so the next launch or foreground can revoke it.
      logger.error(
        "Server logout failed; token not revoked server-side",
        error,
      );
      if (revokeToken && signedInUserId !== undefined) {
        await pendingRevokeStorage.set({
          token: revokeToken,
          userId: String(signedInUserId),
        });
      }
    }
    await tokenStorage.clear();
    // Guarded like expireSession/deleteAccount: a storage rejection here must
    // not skip the durable sweep or the sign-out setState. A blob left on disk
    // is harmless — with no token, the next checkAuth signs out and sweeps.
    try {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {}
    await clearDurableLocalState();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, [stopPushRotation, signedInUserId]);

  /**
   * Local-only session teardown for an expired/revoked token (a token-bearing
   * request came back 401). Distinct from `logout()`: it makes NO server call.
   * The token is already dead, so POSTing `/api/auth/logout` with it would 401
   * and re-trigger the global 401 interceptor — an expiry loop. We also clear
   * the TanStack Query cache so a subsequent sign-in does not read another
   * session's stale data. Local-cleanup failures are swallowed (never throw —
   * this runs from the `SessionExpiryBridge` event handler).
   *
   * MUST stay idempotent: concurrent 401s can fire the bridge more than once
   * (the bridge reads `isAuthenticated` from a render closure that hasn't yet
   * updated), so this may be called repeatedly. All operations here are no-ops
   * the second time, so the repeat is harmless.
   */
  const expireSession = useCallback(async () => {
    try {
      await tokenStorage.clear();
    } catch {}
    try {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {}
    await clearDurableLocalState();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

  /**
   * Permanently deletes the authenticated user's account.
   * Requires the user's current password for confirmation (CCPA/PIPEDA right
   * to erasure). On success, clears local auth state — the root navigator
   * gate switches to the auth stack when `isAuthenticated` flips to false.
   *
   * Throws if the password is wrong or the API request fails. Once the server
   * confirms deletion, local-cleanup failures (token storage, AsyncStorage)
   * are swallowed — the account is gone, so we must NOT surface a retryable
   * error to the user. Auth state is always cleared on success.
   *
   * An account without a password confirms with a fresh provider sign-in
   * instead; resolves false (nothing deleted) when that sheet is cancelled.
   */
  const deleteAccount = useCallback(
    async (proof: DeleteAccountProof, secondFactor?: SecondFactorInput) => {
      // Surface server-side errors (wrong password, network, etc.) to the caller
      // — the account is still intact and the user can retry. On a 2FA account a
      // password alone answers SECOND_FACTOR_REQUIRED; a provider proof never does.
      if ("password" in proof) {
        await apiRequest("DELETE", "/api/auth/account", {
          password: proof.password,
          ...(secondFactor ? { secondFactor } : {}),
        });
      } else {
        const { nonce, nonceHash } = await fetchNonce("reauth");
        const token = await getProviderToken(proof.provider, nonceHash);
        if (!token) return false;
        await apiRequest("DELETE", "/api/auth/account", {
          provider: proof.provider,
          nonce,
          idToken: token.idToken,
        });
      }

      // Server confirmed deletion. Any local-cleanup failures past this point
      // must NOT propagate — the account no longer exists, so retrying would
      // just hit a 401. Best-effort clear, then always flip auth state to false.
      try {
        await tokenStorage.clear();
      } catch {}
      try {
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      } catch {}
      // A queued write would otherwise resurrect the "erased" account's data under
      // the new user, authenticated as them — so the durable sweep is mandatory on
      // the right-to-erasure path too.
      await clearDurableLocalState();
      setState({ user: null, isLoading: false, isAuthenticated: false });
      return true;
    },
    [],
  );

  const updateUser = useCallback(
    async (updates: Partial<User>) => {
      if (!state.user) return;
      const response = await apiRequest("PUT", "/api/auth/profile", updates);
      const updatedUser = await response.json();
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updatedUser));
      setState((prev) => ({ ...prev, user: updatedUser }));
      return updatedUser;
    },
    [state.user],
  );

  /**
   * Change the authenticated user's account email. The server re-authenticates
   * with `password` before accepting the change. Two server modes:
   *  - verification OFF (fail-open) → the response is the updated user; cache it.
   *  - verification ON → the response is a neutral `{ status:
   *    "verification_pending" }` (anti-enumeration), so re-fetch `/api/auth/me`
   *    to surface a successful change (the new, now-unverified address) while a
   *    neutral no-op (duplicate / unchanged) leaves state as-is.
   * Throws on wrong password / duplicate (gate OFF) / rate-limit so the caller
   * can surface the error and keep the dialog open.
   */
  const changeEmail = useCallback(
    async (
      newEmail: string,
      password: string,
      secondFactor?: SecondFactorInput,
    ): Promise<
      { status: "updated"; user: User } | { status: "verification_pending" }
    > => {
      const response = await apiRequest("POST", "/api/auth/change-email", {
        newEmail,
        password,
        ...(secondFactor ? { secondFactor } : {}),
      });
      const data = ((await response.json()) ?? {}) as Record<string, unknown>;
      // Gate OFF echoes the updated user (has an `id`); gate ON returns the
      // neutral pending status with no user object. `data` is the parsed JSON
      // (Response.json → any), matching how updateUser consumes it uncast.
      if (isUser(data)) {
        const user = data;
        await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
        setState((prev) => ({ ...prev, user }));
        return { status: "updated", user };
      }
      await checkAuth();
      return { status: "verification_pending" };
    },
    [checkAuth],
  );

  const {
    connectProvider,
    disconnectProvider,
    disableTwoStep,
    startEmailTwoStep,
    confirmEmailTwoStep,
    resendSignInCode,
    forgetTrustedPhones,
    requestPasswordChangeCode,
    changePassword,
  } = useAccountSecurityActions(establishSession);

  return {
    ...state,
    startEmailTwoStep,
    confirmEmailTwoStep,
    resendSignInCode,
    disableTwoStep,
    forgetTrustedPhones,
    requestPasswordChangeCode,
    changePassword,
    login,
    verifySecondFactor,
    finishSignIn: establishSession,
    register,
    logout,
    expireSession,
    deleteAccount,
    updateUser,
    changeEmail,
    checkAuth,
    signInWithProvider,
    completeSocialSignUp,
    linkWithPassword,
    linkWithProvider,
    connectProvider,
    disconnectProvider,
  };
}
