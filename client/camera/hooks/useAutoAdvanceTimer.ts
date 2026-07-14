import { useEffect } from "react";
import type { ScanPhase, ScanAction } from "../types/scan-phase";

const AUTO_ADVANCE_MS = 1000;

/**
 * Auto-advances out of a step-review phase ~1s after capture, unless a screen
 * reader is active — the budget assumes sighted-user reaction speed and
 * doesn't hold for VoiceOver/TalkBack's hear-then-locate-then-act loop.
 * ProductChip falls back to explicit Confirm/Edit buttons in that mode.
 */
export function useAutoAdvanceTimer(
  phase: ScanPhase,
  screenReaderEnabled: boolean,
  dispatch: (action: ScanAction) => void,
): void {
  useEffect(() => {
    if (screenReaderEnabled) return;
    if (phase.type === "STEP2_REVIEWING") {
      const timer = setTimeout(() => {
        dispatch({ type: "STEP_CONFIRMED" });
      }, AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
    if (phase.type === "STEP3_REVIEWING") {
      const timer = setTimeout(() => {
        dispatch({ type: "CONFIRM_PRODUCT" });
      }, AUTO_ADVANCE_MS);
      return () => clearTimeout(timer);
    }
  }, [phase.type, screenReaderEnabled, dispatch]);
}
