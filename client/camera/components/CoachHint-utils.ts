import type { ScanPhase } from "../types/scan-phase";

export function getCoachMessage(
  phase: ScanPhase,
  elapsedSeconds: number,
): string {
  switch (phase.type) {
    case "IDLE":
    case "HUNTING": {
      if (elapsedSeconds >= 15) return "Or tap to capture manually";
      if (elapsedSeconds >= 10) return "Or tap ⚡ for torch";
      if (elapsedSeconds >= 5) return "Try moving closer";
      return "Point at a barcode";
    }
    case "BARCODE_TRACKING":
      return "Hold steady…";
    case "BARCODE_LOCKED":
      return "Frame the Nutrition Facts panel";
    // Distinct copy from BARCODE_LOCKED on purpose. CoachHint announces via
    // useEffect(…, [message]) on iOS and accessibilityLiveRegion="polite" on
    // Android — neither re-fires on an unchanged string. Sharing the arm would
    // leave a screen-reader user with no announcement at all when the chip
    // collapses after they press "Next: nutrition →". "Now" also confirms
    // to sighted users that the tap registered.
    case "LABEL_PROMPTED":
      return "Product confirmed. Now frame the Nutrition Facts panel";
    case "STEP2_CONFIRMED":
      return "Frame the front of the package";
    case "STEP2_REVIEWING":
    case "STEP3_REVIEWING":
    case "SESSION_COMPLETE":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return "";
  }
}

/**
 * The hint line in the camera shell: the step's own hint (`viewHint`, from
 * the flow view), escalated after 5 s / 10 s / 15 s with nothing caught on a
 * barcode step, "Hold steady…" while a barcode is tracked, and quiet while a
 * found / captured card is up. An empty `viewHint` (the generic flow) stays
 * empty.
 */
export function getFlowCoachMessage(
  phase: ScanPhase,
  viewHint: string,
  elapsedSeconds: number,
): string {
  switch (phase.type) {
    case "IDLE":
    case "HUNTING": {
      if (!viewHint) return "";
      if (elapsedSeconds >= 15) return "Type the number";
      if (elapsedSeconds >= 10) return "Or tap ⚡ for torch";
      if (elapsedSeconds >= 5) return "Try moving closer";
      return viewHint;
    }
    case "BARCODE_TRACKING":
      return "Hold steady…";
    case "LABEL_PROMPTED":
    case "STEP2_CONFIRMED":
      return viewHint;
    case "BARCODE_LOCKED":
    case "STEP2_REVIEWING":
    case "STEP3_REVIEWING":
    case "SESSION_COMPLETE":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return "";
  }
}
