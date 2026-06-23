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
