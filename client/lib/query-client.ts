import {
  QueryClient,
  QueryCache,
  QueryFunction,
  onlineManager,
  focusManager,
} from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { AppState, Platform } from "react-native";
import { tokenStorage } from "./token-storage";
import { ApiError } from "./api-error";
import { reportError } from "./reporter";
import { logger } from "./logger";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  let host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    // Fallback for development — set EXPO_PUBLIC_DOMAIN in .env
    logger.warn("EXPO_PUBLIC_DOMAIN not set, falling back to localhost:3000");
    return "http://localhost:3000";
  }

  // Check if host starts with http:// or https://
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
  }

  // For localhost, use http, otherwise use https
  const protocol = host.startsWith("localhost") ? "http" : "https";
  let url = new URL(`${protocol}://${host}`);

  return url.href;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Preserve the machine-readable `code` from the standard error body
    // ({ error, code? }) so callers can branch on it (e.g. PREMIUM_REQUIRED).
    let code: string | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        typeof (parsed as { code?: unknown }).code === "string"
      ) {
        code = (parsed as { code: string }).code;
      }
    } catch {
      // Non-JSON error body — no machine-readable code to extract.
    }
    // Message keeps the `${status}: ${text}` shape so the 4xx retry guard
    // and existing message-based callers stay valid. The numeric `status` is
    // also attached so callers can branch on the status class (4xx vs 5xx)
    // without regexing the message (see offline-queue-drain.ts).
    throw new ApiError(`${res.status}: ${text}`, code, res.status);
  }
}

type SessionExpiryListener = () => void;

const sessionExpiryListeners = new Set<SessionExpiryListener>();

/**
 * Subscribe to session-expiry events, fired when an authed request (one that
 * carried a Bearer token) is rejected with a 401 — the token is no longer valid
 * (expired/revoked server-side). A single in-tree bridge (`SessionExpiryBridge`)
 * subscribes and performs the local logout. Mirrors `subscribeToQueryErrors`:
 * this module is constructed outside the React tree, so it cannot call the
 * hook-based auth/toast systems directly. Returns an unsubscribe function.
 */
export function subscribeToSessionExpiry(
  listener: SessionExpiryListener,
): () => void {
  sessionExpiryListeners.add(listener);
  return () => {
    sessionExpiryListeners.delete(listener);
  };
}

/**
 * Server error codes that mean the SESSION itself is dead. These are emitted
 * ONLY by the JWT auth middleware (`server/middleware/auth.ts`); the union is
 * mirrored from `shared/types/auth.ts`. A token-bearing 401 with any other code
 * (or none) is a route-handler-level rejection — e.g. `UNAUTHORIZED` from a
 * wrong confirmation password on `DELETE /api/auth/account` — and must NOT log
 * the user out. (`NO_TOKEN` is omitted: it can't co-occur with a token attached.)
 *
 * ⚠️ KEEP IN SYNC (manual): this list mirrors the token-death codes emitted by
 * `server/middleware/auth.ts` / the `ApiError["code"]` union in
 * `shared/types/auth.ts`. It is NOT derived from them (the server emits plain
 * string literals via `sendError`, and there is no shared runtime constant), so
 * if a new token-death code is added server-side it MUST be added here too —
 * otherwise the client silently won't log out on that code.
 */
const SESSION_EXPIRY_CODES = new Set<string>([
  "TOKEN_EXPIRED",
  "TOKEN_INVALID",
  "TOKEN_REVOKED",
]);

/**
 * Emit the session-expiry signal to all subscribers. Exported so the proactive
 * auth check (`useAuth.checkAuth`) — which uses a raw `fetch` to `/api/auth/me`
 * and therefore does NOT flow through the interceptor below — can route a 401 it
 * detects through the same path, so a token that died while the app was
 * backgrounded surfaces the "session expired" toast on foreground resume rather
 * than a silent logout. (The bridge gates on `isAuthenticated`, so a cold-launch
 * expired token stays silent.) Callers are responsible for deciding it's a real
 * session-death 401 before calling this.
 */
export function notifySessionExpired(): void {
  sessionExpiryListeners.forEach((listener) => listener());
}

/**
 * Single chokepoint for the 401 → session-expiry signal. Both authed fetch
 * paths (`apiRequest` and `getQueryFn`) call this immediately after `fetch` and
 * before any status-based branching, so a dead token is detected regardless of
 * the caller's `on401` behavior (including the `returnNull` short-circuit).
 *
 * Two guards must both hold to fire:
 * 1. A Bearer token was attached — a 401 with no token is anonymous / bad
 *    credentials (e.g. a wrong-password login), never session death.
 * 2. The error body carries a session-token code (see `SESSION_EXPIRY_CODES`) —
 *    so an authenticated route's own 401 (wrong password on account delete,
 *    etc.) does not trigger a spurious logout.
 *
 * The body is read via `res.clone()` so the caller's own `res.text()`/`.json()`
 * is left intact.
 */
async function notifyIfSessionExpired(
  res: Response,
  tokenAttached: boolean,
): Promise<void> {
  if (res.status !== 401 || !tokenAttached) return;
  let code: string | undefined;
  try {
    const parsed: unknown = JSON.parse(await res.clone().text());
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { code?: unknown }).code === "string"
    ) {
      code = (parsed as { code: string }).code;
    }
  } catch {
    // Non-JSON / unreadable body — no session code, so not a token rejection.
  }
  if (code && SESSION_EXPIRY_CODES.has(code)) {
    notifySessionExpired();
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
  init?: RequestInit,
  // Optional explicit bearer override. When OMITTED (`undefined`) the token is
  // read from `tokenStorage` at dispatch time — the default for all ~50 callers,
  // unchanged. When PROVIDED (a `string` to pin, or `null` to pin "no auth"),
  // that value is used verbatim and storage is never consulted. The offline
  // queue drain passes the token it already validated post-backoff so the
  // request dispatches under the exact bearer the re-check approved, closing the
  // microtask TOCTOU between that re-check and this dispatch-time read.
  authToken?: string | null,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const headers: Record<string, string> = {};
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const token = authToken !== undefined ? authToken : await tokenStorage.get();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...init,
    method,
    headers: { ...(init?.headers as Record<string, string>), ...headers },
    body: data ? JSON.stringify(data) : undefined,
  });

  await notifyIfSessionExpired(res, Boolean(token));
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const headers: Record<string, string> = {};
    const token = await tokenStorage.get();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(url, {
      headers,
    });

    await notifyIfSessionExpired(res, Boolean(token));

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/**
 * Resolves a recipe image URL to a fully-qualified URI.
 * Handles absolute URLs (http/https), data URIs, and server-relative paths.
 */
export function resolveImageUrl(
  imageUrl: string | null | undefined,
): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http") || imageUrl.startsWith("data:"))
    return imageUrl;
  return `${getApiUrl()}${imageUrl}`;
}

/**
 * Per-query opt-out flag. Set `meta: { silentError: true }` on a query whose
 * screen already renders its own error UI, to suppress the global toast and
 * avoid double-reporting the same failure.
 */
export interface QueryErrorMeta extends Record<string, unknown> {
  silentError?: boolean;
}

/**
 * Decides whether a failed query should surface a global toast. Pure and
 * exported so it can be unit-tested directly (the rest of this module has
 * import-time side effects).
 *
 * Suppressed cases:
 * - `meta.silentError === true` — the screen renders its own error state.
 * - 4xx client errors — screens already branch on these (e.g. PREMIUM_REQUIRED,
 *   404, validation). This also covers the `on401: "throw"` auth-redirect path,
 *   whose ApiError message is `"401: ..."` and matches the 4xx regex below.
 */
export function shouldSurfaceQueryError(
  error: unknown,
  meta: QueryErrorMeta | undefined,
): boolean {
  if (meta?.silentError === true) return false;
  // Mirrors the retry guard above: `${status}: ${text}` message shape.
  if (error instanceof Error && /^4\d\d:/.test(error.message)) return false;
  return true;
}

type QueryErrorListener = (message: string) => void;

const queryErrorListeners = new Set<QueryErrorListener>();

/**
 * Subscribe to global query errors. A single top-level component
 * (`QueryErrorToastBridge`) subscribes and renders a toast — `query-client.ts`
 * is module-level code outside the React tree, so it cannot call the hook-based
 * toast directly. Returns an unsubscribe function.
 */
export function subscribeToQueryErrors(
  listener: QueryErrorListener,
): () => void {
  queryErrorListeners.add(listener);
  return () => {
    queryErrorListeners.delete(listener);
  };
}

const GLOBAL_QUERY_ERROR_MESSAGE =
  "Something went wrong loading your data. Please try again.";

/**
 * Global error net for the TanStack Query client.
 *
 * Mutation policy (documented per the acceptance criteria): the global net is
 * scoped to **queries only**. Mutations keep their existing local `onError`
 * handlers — a cache-level `onError` fires _in addition to_ each observer's
 * local handler in TanStack Query v5, so a global mutation handler would
 * double-toast against the many existing mutation handlers. See
 * `docs/LEARNINGS.md` "mutate onError Missing cancelled Guard" for the local
 * mutation-handler convention.
 *
 * Dedup is free: `ToastProvider.show` replaces the toast list (`setToasts([...])`)
 * rather than appending, so an offline storm of failing queries collapses to a
 * single visible toast. Do not reintroduce a queue here.
 */
const queryCache = new QueryCache({
  onError: (error, query) => {
    if (!shouldSurfaceQueryError(error, query.meta)) return;
    reportError(error, `QueryCache.onError [${String(query.queryKey)}]`);
    queryErrorListeners.forEach((listener) => {
      listener(GLOBAL_QUERY_ERROR_MESSAGE);
    });
  },
});

export const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: (failureCount, error) => {
        // Don't retry client errors (4xx) — only retry transient/server errors
        if (error instanceof Error && /^4\d\d:/.test(error.message))
          return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Wire TanStack Query's onlineManager to NetInfo so the library's internal
 * online flag reflects real React Native connectivity.
 *
 * Null-safe: NetInfo fires its initial callback with isConnected: null while
 * it determines connectivity. We mirror the useNetworkStatus hook: treat null
 * as "not offline" (i.e. online: true) to avoid pausing all initial queries
 * on a cold start. Only explicit false values are treated as offline.
 *
 * With onlineManager wired:
 *  - Queries that failed while offline refetch automatically on reconnect
 *    (the existing refetchOnReconnect default of true activates).
 *  - Paused mutations resume on reconnect via resumePausedMutations().
 *    Note: mutations with retry:false are still paused (not failed) when
 *    triggered offline; networkMode pauses before the first attempt.
 *    Durable resume across app restarts requires the async-storage persister
 *    (@tanstack/query-async-storage-persister) — deferred as a follow-up.
 */
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    // Mirror useNetworkStatus: only explicit false is "offline"; null is
    // indeterminate (cold-start) and must not mark the manager offline.
    const isOnline = !(
      state.isConnected === false || state.isInternetReachable === false
    );
    setOnline(isOnline);
  }),
);

onlineManager.subscribe((isOnline) => {
  if (isOnline) {
    queryClient.resumePausedMutations().catch(() => {
      // resumePausedMutations is best-effort — individual mutation onError
      // handlers will surface failures to the user. Swallow here to avoid
      // an uncaught rejection on the onlineManager subscription.
    });
  }
});

/**
 * Wire TanStack Query's focusManager to React Native's AppState so the library's
 * internal focus flag tracks foreground/background. This is the RN companion to
 * the onlineManager/NetInfo wiring above (per the TanStack RN docs).
 *
 * Decision (todo 2026-05-31-focus-manager-foreground-refetch): we wire the focus
 * SIGNAL but deliberately leave the global `refetchOnWindowFocus: false` default
 * untouched. Rationale:
 *  - Without this wiring, native has no window-focus events, so a query that
 *    opts in with `refetchOnWindowFocus: true` (e.g. useHistoryData,
 *    useCoachContext) silently never refetches on foreground. Wiring focusManager
 *    makes those per-query opt-ins actually fire.
 *  - The global default stays `false` on purpose: `staleTime: 5min` already
 *    bounds freshness, `onlineManager` covers reconnect refetch, and `useAuth`
 *    re-validates the session on foreground. Flipping the global default to true
 *    would risk a refetch storm on every foreground event with no added benefit,
 *    so foreground refetch remains strictly opt-in per query.
 *
 * Platform note: `focusManager.setEventListener` REPLACES TanStack's built-in
 * focus listener on every platform (it does not layer on top of it). We gate the
 * handler to native only, so on web focus detection is effectively a no-op rather
 * than the default document-visibility check. That is acceptable here: the web
 * target isn't built yet, and with the global `refetchOnWindowFocus: false` the
 * only web impact would be the two per-query opt-ins losing focus refetch. The
 * guard keeps native behavior unambiguous; revisit it if/when web ships.
 */

/**
 * Maps a React Native AppState status to a TanStack focus value. Pure and
 * exported so it can be unit-tested directly without triggering this module's
 * import-time manager side effects.
 *
 * Returns `true`/`false` on native (focused iff the app is "active"), and
 * `undefined` on web — the caller treats `undefined` as "skip calling
 * handleFocus", so on web the focus signal is never updated (a no-op listener).
 */
export function appStateToFocus(
  os: typeof Platform.OS,
  status: string,
): boolean | undefined {
  if (os === "web") return undefined;
  return status === "active";
}

focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (state) => {
    const focused = appStateToFocus(Platform.OS, state);
    if (focused !== undefined) {
      handleFocus(focused);
    }
  });
  return () => subscription.remove();
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "@ocrecipes_query_cache",
  throttleTime: 1000,
});

// --- Persisted-query-cache restore gate --------------------------------------
// PersistQueryClientProvider restores the prior session's persisted cache into
// `queryClient` ASYNCHRONOUSLY on mount. A session-teardown sweep that calls
// `queryClient.clear()` before that restore finishes is undone: the restore
// rehydrates the previous user's data into memory AFTER the clear (and, once
// restore completes, the persister re-writes it to disk), re-exposing user A's
// cached data under user B on a shared device. This gate lets the durable sweep
// (`clearDurableLocalState` in useAuth) await restoration-complete first.
//
// Resolved by `markQueryCacheRestored()`, which App.tsx wires to the provider's
// `onSuccess` AND `onError` props — a FAILED restore (corrupt/oversized blob)
// must release the gate too, never wedge teardown. Created eagerly at module
// load so a sweep that runs before the provider's restore effect (React mounts
// deep children's effects before the parent provider's) still awaits an existing
// promise rather than missing the signal.
let resolveQueryCacheRestored: () => void = () => {};
const queryCacheRestored = new Promise<void>((resolve) => {
  resolveQueryCacheRestored = resolve;
});

// Safety cap so a never-firing restore signal (e.g. the provider not mounting in
// some runtime path) cannot wedge a session teardown forever. Far longer than a
// real single-key AsyncStorage restore, so it only ever fires on broken wiring.
// Tradeoff: this caps liveness over strict determinism — if a restore somehow
// exceeded this (pathological for a sub-2MB single-key read), the sweep would
// proceed before it settled. Chosen because a wedged teardown is the worse fault.
const QUERY_CACHE_RESTORE_TIMEOUT_MS = 5000;

/** Idempotently releases the restore gate. Wired to the persister's onSuccess
 *  and onError. Safe to call more than once. */
export function markQueryCacheRestored(): void {
  resolveQueryCacheRestored();
}

/** Resolves once the persisted query cache has finished restoring (or the safety
 *  timeout elapses). Callers awaiting this before `queryClient.clear()` ensure an
 *  in-flight restore can't rehydrate the prior session's data after the clear.
 *  Clears the timer when the gate wins so no stray timeout lingers after each
 *  teardown call (the common case — restore has long since settled). */
export function whenQueryCacheRestored(): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, QUERY_CACHE_RESTORE_TIMEOUT_MS);
    void queryCacheRestored.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
