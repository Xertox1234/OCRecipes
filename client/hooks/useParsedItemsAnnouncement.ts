import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/** Shown/announced when parsed items first appear (see the announce hook). */
export function foundItemsMessage(count: number) {
  return `Found ${count} item${count === 1 ? "" : "s"}. Log All to save.`;
}

/**
 * A successful Quick Log parse announces its item count — every parse, not
 * just the first: a later parse can replace the results without the item list
 * passing back through empty, and a discriminator keyed on "has items" alone
 * misses that case (docs/solutions/logic-errors/imperative-announce-must-be-
 * content-keyed-not-variant-keyed-2026-06-24.md, "Second manifestation").
 * iOS has no live region here, so it always gets the imperative announce.
 * Android's `accessibilityLiveRegion="polite"` text (rendered by the caller
 * with `foundItemsMessage`) re-reads automatically whenever the count changes
 * it; only a same-count replace leaves that text identical, so it needs the
 * explicit announce too — never both, on either platform
 * (docs/rules/accessibility.md → Announcements).
 *
 * `lastRenderedCountRef` must be written on EVERY run of this effect, not
 * only when the generation changes: removeItem (and reset()) change the count
 * — and so the live region's own rendered text — without bumping
 * `parseGeneration`. A version gated behind the generation check went stale
 * across exactly those changes, producing a false negative (a same-count
 * replace after a removeItem stayed silent) and a false positive (a fresh
 * session's first parse double-announced when its count happened to match a
 * prior session's last one) — caught by review with a constructed probe.
 */
export function useParsedItemsAnnouncement(
  parseGeneration: number,
  count: number,
) {
  const announcedGenerationRef = useRef(0);
  const lastRenderedCountRef = useRef(0);
  useEffect(() => {
    const prevRenderedCount = lastRenderedCountRef.current;
    lastRenderedCountRef.current = count;

    if (
      parseGeneration === 0 ||
      parseGeneration === announcedGenerationRef.current
    ) {
      return;
    }
    announcedGenerationRef.current = parseGeneration;
    if (count === 0) return;
    if (Platform.OS === "ios" || count === prevRenderedCount) {
      AccessibilityInfo.announceForAccessibility(foundItemsMessage(count));
    }
  }, [parseGeneration, count]);
}
