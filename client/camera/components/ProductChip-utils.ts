// client/camera/components/ProductChip-utils.ts
import type { ScanPhase } from "../types/scan-phase";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";
import { getContentTypeLabel } from "@/screens/scan-screen-utils";
import { getShutterTopInset } from "./shutter-layout";
import { getConfidenceTier } from "@/lib/confidence";

/**
 * Confidence copy for the smart-scan chip — kept distinct from
 * getConfidenceLabel's "High"/"Medium"/"Low" (that wording belongs to the
 * dedicated confidence badges on PhotoAnalysisScreen etc., not this
 * camera-overlay chip).
 */
export function getChipConfidenceLabel(score: number): string {
  const tier = getConfidenceTier(score);
  if (tier === "high") return "High confidence";
  if (tier === "medium") return "Good match";
  return "Possible match";
}

// Hardcoded overlay-safe accents — this chip renders on a live camera feed
// with no useTheme() access, not app chrome.
export function getChipConfidenceColor(score: number): string {
  const tier = getConfidenceTier(score);
  if (tier === "high") return "#4CD964";
  if (tier === "medium") return "#FFD60A";
  // Low intentionally stays neutral, not alarming, on a live camera feed.
  return "rgba(255,255,255,0.5)";
}

export type ProductChipVariant =
  | "barcode_lock"
  | "step2_review"
  | "step2_confirmed"
  | "step3_review"
  | "session_complete"
  | "smart_photo"
  | "smart_error";

/**
 * Vertical placement for the chip's outer container, derived from the safe
 * area inset rather than a static constant.
 *
 * Every variant — including `session_complete` — raises the chip 8px above
 * the shutter's top edge (`getShutterTopInset(insetsBottom) + 8`) so its
 * background never overlaps the shutter, on any device. `session_complete`
 * previously kept a flush-bottom exception, which both left the overlap
 * unresolved for that phase AND caused an instant, non-animated jump on the
 * transition into it (the `bottom` value changed between variants). Using
 * the same offset for every variant fixes both: no overlap, and no layout
 * property changes on that transition, so nothing to snap.
 *
 * `styles.chip`'s base `padding: 20` already covers bottom padding — no
 * insets-aware padding override is needed here now that no variant sits
 * flush against the screen edge.
 */
export function getShutterClearanceStyle(insetsBottom: number): {
  bottom: number;
} {
  return { bottom: getShutterTopInset(insetsBottom) + 8 };
}

export function getProductChipVariant(
  phase: ScanPhase,
): ProductChipVariant | null {
  switch (phase.type) {
    case "BARCODE_LOCKED":
      return "barcode_lock";
    case "STEP2_REVIEWING":
      return "step2_review";
    case "STEP2_CONFIRMED":
      return "step2_confirmed";
    case "STEP3_REVIEWING":
      return "step3_review";
    case "SESSION_COMPLETE":
      return "session_complete";
    case "SMART_CONFIRMED":
      return "smart_photo";
    case "SMART_ERROR":
      return "smart_error";
    default:
      return null;
  }
}

/**
 * Label for the smart-scan (`SMART_CONFIRMED`) confirmation chip.
 *
 * Prefers the first detected food's name. When the classification carries no
 * foods (classification-only results — menus, receipts, raw ingredients), it
 * falls back to a content-type-derived label (e.g. "Restaurant menu detected")
 * via the shared `getContentTypeLabel` map rather than the generic
 * "Food detected". Only when no `contentType` is present does it use the
 * generic fallback.
 */
export function getSmartConfirmLabel(
  classification: Pick<PhotoAnalysisResponse, "foods" | "contentType">,
): string {
  const foodName = classification.foods[0]?.name;
  if (foodName) return foodName;
  const { contentType } = classification;
  if (contentType) return `${getContentTypeLabel(contentType)} detected`;
  // Defensive fallback only: `intent: "auto"` responses (the sole path that
  // reaches this chip) always carry a `contentType`, so this is not an expected
  // production UX state.
  return "Food detected";
}

/**
 * Screen-reader announcement string for a chip variant transition.
 *
 * ProductChip announces imperatively via `AccessibilityInfo.announceForAccessibility`
 * on BOTH platforms, once per variant transition (the chip has no container
 * `accessibilityLiveRegion` — that re-read the whole subtree on the smart-confirm
 * busy swap). This string is the spoken text for appear (null→non-null) and
 * non-null→non-null transitions alike. The `smart_photo` variant derives its
 * announcement from `getSmartConfirmLabel(phase.classification)` so the spoken
 * text matches the visible content-type-specific label (e.g. "Restaurant menu
 * detected, tap to confirm") instead of a generic "Photo analyzed". All other
 * variants use a fixed string.
 */
export function getChipAnnounceText(
  variant: NonNullable<ProductChipVariant>,
  phase: ScanPhase,
): string {
  if (variant === "smart_photo" && phase.type === "SMART_CONFIRMED") {
    return `${getSmartConfirmLabel(phase.classification)}, tap to confirm`;
  }
  switch (variant) {
    case "barcode_lock":
      return "Product found, tap to view details";
    case "step2_review":
      return "Nutrition label scanned, review values";
    case "step2_confirmed":
      return "Nutrition values confirmed";
    case "step3_review":
      return "Front label scanned, review values";
    case "session_complete":
      return "Scan complete";
    case "smart_error":
      return "Couldn't identify this food, try again";
    case "smart_photo":
      // Defensive: variant === "smart_photo" without a SMART_CONFIRMED phase is
      // not reachable (the variant is derived from that phase), but keep a
      // sensible fallback rather than throwing.
      return "Photo analyzed, tap to confirm";
  }
}
