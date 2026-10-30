import { useCallback, useEffect, useRef } from "react";
import { subscribePushTokenRotation } from "@/lib/push-token-registration";

/**
 * While `active` (signed in), re-send a push token the platform rotates at
 * runtime. Returns a stable `stop()` so logout can stop listening BEFORE it
 * unregisters the token, and a late rotation cannot re-add this device to the
 * signed-out account. Stopping is idempotent, so the effect cleanup that
 * follows a stop() is harmless.
 */
export function usePushTokenRotation(active: boolean): () => void {
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;
    const stop = subscribePushTokenRotation();
    stopRef.current = stop;
    return () => {
      stop();
      if (stopRef.current === stop) stopRef.current = null;
    };
  }, [active]);

  return useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);
}
