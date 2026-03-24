import { useState, useEffect, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";

/**
 * Hook that tracks network connectivity state.
 * Returns `isOffline` (true when device has no internet) and
 * `wasOffline` (true briefly after reconnection, for "Back online" messaging).
 */
export function useNetworkStatus() {
  const [isOffline, setIsOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const previouslyOffline = useRef(false);

  useEffect(() => {
    // addEventListener fires immediately with current state, then on changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = !(
        state.isConnected && state.isInternetReachable !== false
      );

      if (!offline && previouslyOffline.current) {
        // Just came back online — signal "was offline" briefly
        setWasOffline(true);
      }

      previouslyOffline.current = offline;
      setIsOffline(offline);
    });

    return unsubscribe;
  }, []);

  const clearWasOffline = () => setWasOffline(false);

  return { isOffline, wasOffline, clearWasOffline };
}
