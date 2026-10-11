import { useState, useEffect, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  apiRequest,
  getApiUrl,
  queryClient,
  notifySessionExpired,
  whenQueryCacheRestored,
} from "@/lib/query-client";
import { tokenStorage, trustKeyStorage } from "@/lib/token-storage";
import type {
  MfaChallengeResult,
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
import { upgradeRequest } from "@/lib/upgrade-pass-request";
import { getProviderToken } from "@/lib/social-sign-in";
import {
  registerPushToken,
  unregisterPushToken,
} from "@/lib/push-token-registration";
import { clearOfflineQueue } from "@/lib/offline-queue";
import { clearHomeActionsState } from "@/lib/home-actions-storage";
import { clearRecentSearches } from "@/lib/recent-recipe-searches-storage";
import { clearScheduledCoachReminders } from "@/hooks/useNotebookNotifications";
import { reconcileDurableOwner, AUTH_STORAGE_KEY } from "@/lib/durable-owner";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const QUERY_CACHE_KEY = "@ocrecipes_query_cache";

/**
 * Best-effort teardown of every piece of device-local state that outlives a
 * session: the durable offline mutation queue, the persisted TanStack Query
 * cache, the in-memory query cache, and the per-user home-action history (recent
 * actions + usage counts). EVERY session-ending path — logout, expireSession,
 * deleteAccount, and the checkAuth dead-token branch — must call this so the
 * prior session's queued writes can't replay, and its cached/behavioral data
 * can't rehydrate, under whoever signs in next on this device. These keys are
 * all global (not user-namespaced) and login() does not clear them, so this is
 * the only thing standing between two accounts on a shared device.
 *
 * Contractually NON-THROWING: callers rely on this never rejecting so a clear
 * failure can't skip the auth-state reset that follows it. Clears the offline
 * queue FIRST so the privacy-critical replay fix always runs even if a later
 * removeItem rejects (clearOfflineQueue swallows its own errors, can't throw).
 *
 * clearOfflineQueue() serializes against the startup queue load, and the query
 * cache clear waits on whenQueryCacheRestored(), so neither a concurrent
 * initOfflineQueue() re-persist nor an in-flight PersistQueryClientProvider
 * restore can resurrect the prior session's durable state AFTER this sweep,
 * closing the cross-user replay/rehydrate race on a shared device. The queue
 * close is fully deterministic (a hard promise dependency); the query-cache
 * close holds as long as the restore settles within the gate's safety timeout
 * (whenQueryCacheRestored), which it always does outside of broken provider
 * wiring — see that function for the bound.
 *
 * Returns whether EVERY store's disk wipe was confirmed (no swallowed
 * `removeItem` failure). `reconcileDurableOwner` advances the durable-owner
 * marker only on a `true` return, so a failed disk wipe leaves the marker stale
 * and the next auth resolution retries — making the no-cross-user-resurrection
 * guarantee survive an app restart, not just an in-session timing window. The
 * five teardown callers ignore the return (they only need the best-effort wipe);
 * it is the reconcile path that reads it.
 */
async function clearDurableLocalState(): Promise<boolean> {
  let ok = true;
  try {
    if (!(await clearOfflineQueue())) ok = false;
    // Clear this device's per-user home-action history (recent-actions list +
    // per-action usage counts). These are global, non-namespaced keys that would
    // otherwise seed the next user's Home UI on a shared device. Placed right
    // after the queue clear so it still runs if the query-cache block below
    // throws; it serializes against its own startup init and is non-throwing.
    // (Section-expansion state stays — a device-display pref; theme is its own module.)
    if (!(await clearHomeActionsState())) ok = false;
    // Recent recipe searches: same global, non-namespaced key with the same
    // cross-user bleed risk on a shared device; clear them on every session-ending
    // path. Non-throwing; a failed wipe feeds `ok` so the durable-owner marker is
    // not advanced past this user (the next auth resolution retries).
    if (!(await clearRecentSearches())) ok = false;
    // OS-scheduled coach reminders carry this user's journal text and outlive
    // the session in the OS; cancel them and drop their global id map.
    if (!(await clearScheduledCoachReminders())) ok = false;
    // Gate on the persisted-cache restore: a teardown that races a cold-start
    // restore could otherwise clear() the cache before the restore rehydrates the
    // prior user's data into memory, re-exposing it under the next user. Resolves
    // immediately once restore has settled (bounded by a safety timeout).
    await whenQueryCacheRestored();
    // Clear the in-memory cache FIRST, then remove the disk key. The throttled
    // persister reads the LIVE cache when it fires, so clearing memory first means
    // any re-persist (pending, or scheduled by clear() itself) only ever writes an
    // EMPTY cache — never re-persisting A's data in the gap before removeItem.
    // Guard clear() independently so a (pathological) throw can't skip the disk
    // removal — the original ordering relied on clear() being last for this.
    try {
      queryClient.clear();
    } catch {}
    // Guard the disk removal independently so its failure feeds `ok` (gating the
    // owner-marker advance) without aborting — and without poisoning the marker
    // into never advancing if some OTHER step throws.
    try {
      await AsyncStorage.removeItem(QUERY_CACHE_KEY);
    } catch {
      ok = false;
    }
  } catch {
    ok = false;
  }
  return ok;
}

/** A new authenticator secret, shown once (setup or new phone). */
export interface TwoStepSecret {
  secret: string;
  otpauthUrl: string;
}

export type DeleteAccountProof =
  | { password: string }
  | { provider: SocialProvider };

/**
 * apiRequest sends the stored bearer when there is one, so a signed-in caller
 * gets a nonce bound to its account (the server rejects public nonces for it).
 */
async function fetchNonce(
  purpose: "sign_in" | "link" | "reauth",
): Promise<{ nonce: string; nonceHash: string }> {
  const res = await apiRequest("POST", "/api/auth/social/nonce", { purpose });
  return (await res.json()) as { nonce: string; nonceHash: string };
}

/**
 * Reconcile durable-store ownership for a user becoming active. Guards against a
 * malformed identity (missing id) writing an "undefined" owner — a no-op when the
 * id is absent. Stringifies the id so the marker compares cleanly whether the
 * server serializes it as a string or a number. `clearDurableLocalState` is the
 * confirmed-wipe the marker advance is gated on.
 */
async function reconcileOwnerFor(id: unknown): Promise<void> {
  if (id == null) return;
  await reconcileDurableOwner(String(id), clearDurableLocalState);
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const checkAuth = useCallback(async () => {
    try {
      const token = await tokenStorage.get();
      if (!token) {
        // Cold-start with no token is also a teardown-shaped path: a force-quit
        // can interrupt a session teardown in the gap between tokenStorage.clear()
        // and the durable sweep, leaving the durable offline queue / persisted
        // query cache on disk with no token. Sweep them here too so this branch
        // is consistent with the other four teardown paths and the prior
        // session's residual durable state is cleared. The sweep now SERIALIZES
        // against the startup initializers it used to race — clearOfflineQueue()
        // awaits the in-flight initOfflineQueue() re-persist, and the query-cache
        // clear awaits the persister's restore — so an orphaned queue / cache can
        // no longer be resurrected after the sweep (the same close applies to the
        // dead-token branch below). clearDurableLocalState() is contractually
        // non-throwing and a verified no-op on the common "fresh install, never
        // logged in" cold start.
        await clearDurableLocalState();
        setState({ user: null, isLoading: false, isAuthenticated: false });
        return;
      }

      try {
        const response = await fetch(`${getApiUrl()}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        // The token changed while /me was in flight (sign-out + new sign-in, or
        // a 2FA token swap): this answer is about a session that already ended,
        // so it must neither clear the new token nor write the old profile
        // (auth audit 2026-10-10 L7). The new session set its own state.
        if ((await tokenStorage.get()) !== token) return;

        if (response.ok) {
          const freshUser = await response.json();
          await AsyncStorage.setItem(
            AUTH_STORAGE_KEY,
            JSON.stringify(freshUser),
          );
          // Reconcile durable-store ownership BEFORE the Home tree can mount: a
          // cold start that resolves a DIFFERENT user than the durable stores were
          // last confirmed clean-for (e.g. a prior logout's wipe failed) wipes them
          // here so the stale history/queue/cache can't surface under this user.
          // A no-op when the marker already matches (the common resume).
          await reconcileOwnerFor(freshUser.id);
          setState({
            user: freshUser,
            isLoading: false,
            isAuthenticated: true,
          });
        } else {
          // Token invalid/expired (e.g. detected on foreground resume). Route a
          // 401 through the shared session-expiry signal so the
          // SessionExpiryBridge shows the "session expired" toast instead of a
          // silent drop. The bridge's isAuthenticated gate keeps a cold-launch
          // expired token silent. Non-401 failures are not session death.
          if (response.status === 401) {
            notifySessionExpired();
          }
          await tokenStorage.clear();
          await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
          // Dead-token detection is a session teardown (an expired/revoked token
          // caught on cold launch or foreground resume). The SessionExpiryBridge
          // can't cover this path — its isAuthenticated gate is false on cold
          // launch — so the durable-state sweep must happen here.
          await clearDurableLocalState();
          setState({ user: null, isLoading: false, isAuthenticated: false });
        }
      } catch {
        // Network error - use cached data if available
        const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        let cachedUser: User | null = null;
        if (stored) {
          try {
            cachedUser = JSON.parse(stored) as User;
          } catch {
            // Corrupt cache blob. This must NOT log the user out: the session
            // token is still valid — only the convenience cache is unreadable.
            // Drop the poison key so it stops re-throwing, then fall through to
            // the no-cache path WITH the token preserved. The next foreground
            // re-check / relaunch re-validates and restores the session.
            await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
          }
        }
        if (cachedUser) {
          // Reconcile here too: this offline-resume path runs neither a teardown
          // nor any other reconcile, and the query cache (unlike the home-actions
          // and offline-queue stores, which gate at their own read points) has no
          // independent owner gate. A user switch can't happen offline, so the
          // marker normally matches and this is a no-op that preserves the offline
          // cache; it only wipes when the marker proves the restored data isn't
          // this user's (a prior failed wipe), closing the last query-cache hole.
          await reconcileOwnerFor(cachedUser.id);
          setState({
            user: cachedUser,
            isLoading: false,
            isAuthenticated: true,
          });
        } else {
          setState({ user: null, isLoading: false, isAuthenticated: false });
        }
      }
    } catch {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

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
          });
        }
      },
    );
    return () => subscription.remove();
  }, [checkAuth]);

  // Shared by every path that ends with a session token (password login and
  // each Google/Apple path).
  const establishSession = useCallback(async (user: User, token: string) => {
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
   * the code screen, and nothing is stored until the code passes. A password
   * under 15 on an account without two-step answers with an upgrade pass
   * (password policy spec §5.2): the caller routes to PasswordUpgrade.
   */
  const login = useCallback(
    async (username: string, password: string): Promise<SessionResult> => {
      const trustKey = await trustKeyStorage.get();
      const response = await apiRequest("POST", "/api/auth/login", {
        username,
        password,
        ...(trustKey ? { trustKey } : {}),
      });
      const data = (await response.json()) as
        | MfaChallengeResult
        | UpgradeRequiredResult
        | { user: User; token: string };
      if ("status" in data) return data;
      const { user, token } = data as { user: User; token: string };
      await establishSession(user, token);
      return { status: "signed_in", user, token };
    },
    [establishSession],
  );

  /**
   * Answer a two-step challenge. Keeps a returned "trust this phone" key but
   * does NOT sign in: the screen first shows a replacement recovery code (if a
   * recovery code was spent), then calls finishSignIn.
   */
  const verifySecondFactor = useCallback(
    async (
      challenge: string,
      proof: SecondFactorInput,
      trustDevice: boolean,
    ): Promise<MfaVerifyResult> => {
      const res = await apiRequest("POST", "/api/auth/mfa/verify", {
        challenge,
        secondFactor: proof,
        trustDevice,
      });
      const result = (await res.json()) as MfaVerifyResult;
      if (result.trustKey) await trustKeyStorage.set(result.trustKey);
      return result;
    },
    [],
  );

  // ── Sign in with Apple (Google later) ──────────────────────────────────
  // The provider sheet gets the nonce HASH; the server gets the raw nonce and
  // checks the token's nonce claim against sha256(raw). Returns null when the
  // person cancels the sheet.
  const signInWithProvider = useCallback(
    async (provider: SocialProvider): Promise<SocialSignInResult | null> => {
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
    },
    [establishSession],
  );

  const completeSocialSignUp = useCallback(
    async (ticket: string, username: string, ageConfirmed: boolean) => {
      const res = await apiRequest(
        "POST",
        "/api/auth/social/complete-sign-up",
        // COPPA 13+ attestation — the person's actual checkbox state.
        { ticket, username, ageConfirmed },
      );
      const { user, token } = await res.json();
      await establishSession(user, token);
    },
    [establishSession],
  );

  /** The Connect prompt's password proof; a 2FA account answers with a challenge. */
  const linkWithPassword = useCallback(
    async (ticket: string, password: string): Promise<SessionResult> => {
      const res = await apiRequest("POST", "/api/auth/social/link", {
        ticket,
        password,
      });
      const result = (await res.json()) as SessionResult;
      if (result.status === "signed_in") {
        await establishSession(result.user, result.token);
      }
      return result;
    },
    [establishSession],
  );

  const linkWithProvider = useCallback(
    async (ticket: string, provider: SocialProvider) => {
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
    },
    [establishSession],
  );

  const register = useCallback(
    async (
      username: string,
      password: string,
      email: string,
      ageConfirmed: boolean,
      // The "Use two-step verification" switch (spec P4): 8+ instead of 15+.
      twoStep = false,
    ): Promise<
      | { status: "authenticated"; user: User }
      | { status: "verification_pending" }
      | UpgradeRequiredResult
    > => {
      const response = await apiRequest("POST", "/api/auth/register", {
        username,
        password,
        email,
        // COPPA 13+ age attestation — caller forwards user's actual checkbox
        // state; server enforces with `z.literal(true)` (zero trust on client).
        ageConfirmed,
        ...(twoStep ? { twoStep: true } : {}),
      });
      const data = await response.json();
      // Verification OFF with the switch on and a password under 15: no
      // session yet — the caller routes to PasswordUpgrade (spec §5.1).
      if (data.status === "upgrade_required") {
        return data as UpgradeRequiredResult;
      }
      // Verification OFF (fail-open) → server returns a token → auto-login,
      // preserving the pre-feature behavior.
      if (data.token) {
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
    // session token the DELETE needs (unregisterPushToken never throws).
    await unregisterPushToken();
    try {
      await apiRequest("POST", "/api/auth/logout", {});
    } catch {}
    await tokenStorage.clear();
    // Guarded like expireSession/deleteAccount: a storage rejection here must
    // not skip the durable sweep or the sign-out setState. A blob left on disk
    // is harmless — with no token, the next checkAuth signs out and sweeps.
    try {
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {}
    await clearDurableLocalState();
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

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
    ): Promise<{
      signInMethods: SignInMethods;
      /** A spent recovery code's replacement — show it once. */
      replacementRecoveryCode?: string;
    } | null> => {
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
      return (await res.json()) as {
        signInMethods: SignInMethods;
        replacementRecoveryCode?: string;
      };
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
      (
        | { status: "updated"; user: User }
        | { status: "verification_pending" }
      ) & { replacementRecoveryCode?: string }
    > => {
      const response = await apiRequest("POST", "/api/auth/change-email", {
        newEmail,
        password,
        ...(secondFactor ? { secondFactor } : {}),
      });
      const raw = await response.json();
      // A spent recovery code's replacement rides along; it is not user data.
      const { replacementRecoveryCode, ...data } = (raw ?? {}) as Record<
        string,
        unknown
      > & { replacementRecoveryCode?: string };
      const replacement = replacementRecoveryCode
        ? { replacementRecoveryCode }
        : {};
      // Gate OFF echoes the updated user (has an `id`); gate ON returns the
      // neutral pending status with no user object. `data` is the parsed JSON
      // (Response.json → any), matching how updateUser consumes it uncast.
      if ("id" in data) {
        const user = data as unknown as User;
        await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
        setState((prev) => ({ ...prev, user }));
        return { status: "updated", user, ...replacement };
      }
      await checkAuth();
      return { status: "verification_pending", ...replacement };
    },
    [checkAuth],
  );

  // ── Two-step verification management (Profile → Sign-in methods) ────────
  const startTwoStepSetup = useCallback(
    async (password: string): Promise<TwoStepSecret> => {
      const res = await apiRequest("POST", "/api/auth/mfa/totp/setup", {
        password,
      });
      return (await res.json()) as TwoStepSecret;
    },
    [],
  );

  const startNewPhone = useCallback(
    async (
      password: string,
      secondFactor: SecondFactorInput,
    ): Promise<TwoStepSecret & { replacementRecoveryCode?: string }> => {
      const res = await apiRequest("POST", "/api/auth/mfa/totp/reset", {
        password,
        secondFactor,
      });
      return (await res.json()) as TwoStepSecret & {
        replacementRecoveryCode?: string;
      };
    },
    [],
  );

  /** Finish setup or a new phone. Other devices were signed out; keep this one. */
  const confirmTwoStep = useCallback(
    async (code: string): Promise<{ recoveryCodes?: string[] }> => {
      const res = await apiRequest("POST", "/api/auth/mfa/totp/confirm", {
        code,
      });
      const data = (await res.json()) as SignedInResult & {
        recoveryCodes?: string[];
      };
      await establishSession(data.user, data.token);
      return data.recoveryCodes ? { recoveryCodes: data.recoveryCodes } : {};
    },
    [establishSession],
  );

  /** Turn two-step off. Every device was signed out; keep this one. */
  // `newPassword` replaces a password under 15 in the same step (the server
  // answers PASSWORD_UPGRADE_NEEDED without it); sent only when given.
  const disableTwoStep = useCallback(
    async (
      password: string,
      secondFactor: SecondFactorInput,
      newPassword?: string,
    ) => {
      const res = await apiRequest("POST", "/api/auth/mfa/disable", {
        password,
        secondFactor,
        ...(newPassword ? { newPassword } : {}),
      });
      const data = (await res.json()) as SignedInResult;
      await establishSession(data.user, data.token);
    },
    [establishSession],
  );

  const replaceRecoveryCodes = useCallback(
    async (
      password: string,
      secondFactor: SecondFactorInput,
    ): Promise<string[]> => {
      const res = await apiRequest("POST", "/api/auth/mfa/recovery-codes", {
        password,
        secondFactor,
      });
      return ((await res.json()) as { recoveryCodes: string[] }).recoveryCodes;
    },
    [],
  );

  /** Every trusted phone asks for the code again — this one included. */
  const forgetTrustedPhones = useCallback(async () => {
    await apiRequest("DELETE", "/api/auth/mfa/trusted-devices");
    await trustKeyStorage.clear();
  }, []);

  // ── A short password's upgrade pass (password policy spec §6) ─────────
  // Every call rides the pass, never the stored Bearer token.

  const upgradeStartTwoStep = useCallback(
    async (pass: string): Promise<TwoStepSecret> => {
      const res = await upgradeRequest("/api/auth/upgrade/totp/setup", pass);
      return (await res.json()) as TwoStepSecret;
    },
    [],
  );

  /**
   * Returns the session WITHOUT signing in: signing in swaps the whole
   * navigator, which would unmount the screen before the recovery codes are
   * saved. The screen calls finishSignIn once they are.
   */
  const upgradeConfirmTwoStep = useCallback(
    async (
      pass: string,
      code: string,
    ): Promise<{ session: SignedInResult; recoveryCodes: string[] }> => {
      const res = await upgradeRequest("/api/auth/upgrade/totp/confirm", pass, {
        code,
      });
      const { recoveryCodes, ...session } =
        (await res.json()) as SignedInResult & {
          recoveryCodes: string[];
        };
      return { session, recoveryCodes };
    },
    [],
  );

  const upgradeSetPassword = useCallback(
    async (pass: string, newPassword: string) => {
      const before = await tokenStorage.get();
      const res = await upgradeRequest("/api/auth/upgrade/password", pass, {
        newPassword,
      });
      const { user, token } = (await res.json()) as SignedInResult;
      // Someone signed in on this phone while it was in flight (the screen
      // can be left mid-request): a late reply never replaces that session
      // (auth audit L2). The password change itself stands.
      if ((await tokenStorage.get()) !== before) return;
      await establishSession(user, token);
    },
    [establishSession],
  );

  return {
    ...state,
    startTwoStepSetup,
    startNewPhone,
    confirmTwoStep,
    disableTwoStep,
    replaceRecoveryCodes,
    forgetTrustedPhones,
    upgradeStartTwoStep,
    upgradeConfirmTwoStep,
    upgradeSetPassword,
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
