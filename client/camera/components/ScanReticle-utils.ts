// client/camera/components/ScanReticle-utils.ts
import type { ScanPhase } from "../types/scan-phase";

export const BARCODE_RETICLE = { width: 260, height: 160 } as const;
export const LABEL_RETICLE = { width: 200, height: 270 } as const;
const LOCK_THRESHOLD_FRAMES = 7;

export interface ReticleTarget {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

// bounds are camera-space normalized (0.0–1.0)
function boundsToTarget(
  bounds: { x: number; y: number; width: number; height: number },
  screenWidth: number,
  screenHeight: number,
): Pick<ReticleTarget, "cx" | "cy"> {
  return {
    cx: (bounds.x + bounds.width / 2) * screenWidth,
    cy: (bounds.y + bounds.height / 2) * screenHeight,
  };
}

export function getReticleTarget(
  phase: ScanPhase,
  screenWidth: number,
  screenHeight: number,
): ReticleTarget {
  const center = { cx: screenWidth / 2, cy: screenHeight / 2 };
  switch (phase.type) {
    case "BARCODE_TRACKING": {
      const { cx, cy } = boundsToTarget(
        phase.bounds,
        screenWidth,
        screenHeight,
      );
      return { cx, cy, ...BARCODE_RETICLE };
    }
    case "BARCODE_LOCKED": {
      const { cx, cy } = boundsToTarget(
        phase.bounds,
        screenWidth,
        screenHeight,
      );
      return { cx, cy, ...BARCODE_RETICLE };
    }
    case "STEP2_CAPTURING":
    case "STEP2_REVIEWING":
    case "STEP2_CONFIRMED":
    case "STEP3_CAPTURING":
    case "STEP3_REVIEWING":
      return { ...center, ...LABEL_RETICLE };
    default:
      return { ...center, ...BARCODE_RETICLE };
  }
}

export function getConfidenceFromPhase(phase: ScanPhase): number {
  switch (phase.type) {
    case "IDLE":
    case "HUNTING":
      return 0;
    case "BARCODE_TRACKING":
      return Math.min(phase.frameCount / LOCK_THRESHOLD_FRAMES, 1.0);
    default:
      return 1.0;
  }
}
