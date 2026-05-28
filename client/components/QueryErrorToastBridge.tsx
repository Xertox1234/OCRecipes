import { useEffect } from "react";

import { subscribeToQueryErrors } from "@/lib/query-client";
import { useToast } from "@/context/ToastContext";

/**
 * Bridges module-level query errors to the React-tree toast system.
 *
 * `query-client.ts` constructs the `QueryClient` outside the React tree, so its
 * global `QueryCache.onError` cannot call the hook-based toast directly. This
 * component subscribes to the module-level error emitter and renders a
 * non-blocking toast as an app-wide backstop for failed queries that no screen
 * surfaced. Render it once, as a sibling inside `<ToastProvider>`.
 *
 * Renders nothing.
 */
export function QueryErrorToastBridge(): null {
  const toast = useToast();

  useEffect(() => {
    return subscribeToQueryErrors((message) => {
      toast.error(message);
    });
  }, [toast]);

  return null;
}
