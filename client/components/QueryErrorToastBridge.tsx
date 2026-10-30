import { useEffect } from "react";

import {
  subscribeToPausedMutations,
  subscribeToQueryErrors,
} from "@/lib/query-client";
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
    const offErrors = subscribeToQueryErrors((message) => {
      // Background failure, not a reply to a tap — no haptic.
      toast.error(message, { haptic: false });
    });
    // An action tapped offline is paused until reconnect (R19); without this
    // its button just spins. Emitted once per offline stretch.
    const offPaused = subscribeToPausedMutations(() => {
      toast.info("You're offline. This will finish when you reconnect.", {
        haptic: false,
      });
    });
    return () => {
      offErrors();
      offPaused();
    };
  }, [toast]);

  return null;
}
