// client/camera/components/ProductChip-utils.ts
import type { ScanPhase } from "../types/scan-phase";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";
import { getContentTypeLabel } from "@/screens/scan-screen-utils";

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
 * ScanScreen's bottom shutter row has `paddingBottom: insets.bottom + 16`
 * under a 72px shutter circle, so the shutter's top edge sits at
 * `insets.bottom + 88` from the screen bottom. Every variant except
 * `session_complete` raises the chip 8px above that (`insets.bottom + 96`)
 * so its background never overlaps the shutter, on any device. A static
 * offset (e.g. a fixed 92, as `ZoomLabel.tsx` uses for its much smaller
 * transient label) would under-clear once `insetsBottom > 4`.
 *
 * `session_complete` keeps the pre-fix flush-bottom layout (`bottom`
 * omitted, `paddingBottom: 20 + insetsBottom`) unchanged — it's a transient
 * phase that auto-navigates away almost immediately, so a brief overlap
 * there is an accepted tradeoff (see the todo's acceptance criteria).
 *
 * For a raised variant, `paddingBottom` is a flat 20 (matching the
 * container's top padding) rather than `20 + insetsBottom` — the `bottom`
 * offset above already accounts for insetsBottom, so adding it again to the
 * padding would double-count it and leave dead whitespace below the last
 * button/caption.
 */
export function getShutterClearanceStyle(
  variant: ProductChipVariant | null,
  insetsBottom: number,
): { bottom?: number; paddingBottom: number } {
  if (variant === "session_complete") {
    return { paddingBottom: 20 + insetsBottom };
  }
  return { bottom: insetsBottom + 96, paddingBottom: 20 };
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
