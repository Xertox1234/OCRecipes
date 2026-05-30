import { QueryClient, QueryCache, QueryFunction } from "@tanstack/react-query";
import { tokenStorage } from "./token-storage";
import { ApiError } from "./api-error";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  let host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    // Fallback for development — set EXPO_PUBLIC_DOMAIN in .env
    console.warn("EXPO_PUBLIC_DOMAIN not set, falling back to localhost:3000");
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
    // and existing message-based callers stay valid.
    throw new ApiError(`${res.status}: ${text}`, code);
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
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const headers: Record<string, string> = {};
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const token = await tokenStorage.get();
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
