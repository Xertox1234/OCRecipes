import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Delay before announcing "Loading". Required on modal routes, where the OS's
 * present-focus shift swallows an immediate announcement on iOS
 * (docs/solutions/conventions/on-open-announce-must-delay-past-modal-present-focus-shift-2026-06-25.md);
 * harmless elsewhere, so every skeleton screen uses it.
 */
export const LOADING_ANNOUNCEMENT_DELAY_MS = 500;

/**
 * Announces "Loading" once a loading skeleton has been showing for
 * LOADING_ANNOUNCEMENT_DELAY_MS. The skeleton itself is hidden from screen
 * readers (SkeletonLoadingRegion), so this is the screen's only loading
 * signal. Going inactive before the delay (content arrived, or an error did)
 * or unmounting cancels it, so no stale "Loading" is spoken; becoming active
 * again announces again.
 */
export function useDelayedLoadingAnnouncement(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility("Loading");
    }, LOADING_ANNOUNCEMENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active]);
}
