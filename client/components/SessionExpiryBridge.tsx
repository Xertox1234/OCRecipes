import { useEffect } from "react";

import { subscribeToSessionExpiry } from "@/lib/query-client";
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

/**
 * Bridges the module-level session-expiry signal to the React tree.
 *
 * `query-client.ts` detects a token-bearing 401 outside the React tree (it
 * constructs the `QueryClient` at module load), so it cannot call the auth/toast
 * hooks directly. This component subscribes to that emitter and performs the
 * user-facing logout: a local-only session teardown (`expireSession`, no server
 * round-trip) plus a clear "session expired" toast. The root navigator gate
 * switches to the auth stack when `isAuthenticated` flips to false. Render it
 * once, as a sibling inside `<AuthProvider>` and `<ToastProvider>`.
 *
 * The `isAuthenticated` guard ignores a 401 when there is no live session — e.g.
 * a stray request during cold launch before `checkAuth` resolves — so a fresh
 * launch with a dead token opens quietly to Login instead of flashing an alarming
 * "session expired" message.
 *
 * Renders nothing.
 */
export function SessionExpiryBridge(): null {
  const { isAuthenticated, expireSession } = useAuthContext();
  const toast = useToast();

  useEffect(() => {
    return subscribeToSessionExpiry(() => {
      if (!isAuthenticated) return;
      void expireSession();
      toast.error("Your session has expired. Please sign in again.");
    });
  }, [isAuthenticated, expireSession, toast]);

  return null;
}
