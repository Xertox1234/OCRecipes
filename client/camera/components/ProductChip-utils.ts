// client/camera/components/ProductChip-utils.ts
import type { ScanPhase } from "../types/scan-phase";

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
