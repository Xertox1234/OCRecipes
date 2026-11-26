// client/screens/coach-barcode-pacing-utils.ts
/**
 * Pacing for the Coach's live barcode scanner, so a scan reads as a scan and
 * not as a surprise: the viewfinder settles before it listens, the corners
 * fill in while the same code holds, a sweep plays while the chat is already
 * looking the product up, and the digits show before the screen closes.
 */
import { LOCK_THRESHOLD_FRAMES } from "@/camera/components/ScanReticle-utils";

/** The viewfinder settles before it reads: nothing fires as the camera opens. */
export const ARM_MS = 700;
/** No read for this long while holding: the barcode left the frame. */
export const LOST_MS = 450;
/** The scanning sweep, played while the lookup already runs. */
export const SWEEP_MS = 1100;
/** The digits stay up this long before the screen closes. */
export const REVEAL_MS = 800;

export type PacingState =
  | { phase: "arming" }
  | { phase: "hunting" }
  | { phase: "tracking"; code: string; frames: number }
  | { phase: "scanning"; code: string }
  | { phase: "found"; code: string }
  | { phase: "done"; code: string };

export type PacingEvent =
  | { type: "armed" }
  /** A valid product code on one camera frame. */
  | { type: "read"; code: string }
  | { type: "lost" }
  | { type: "swept" }
  | { type: "revealed" };

export const INITIAL_PACING: PacingState = { phase: "arming" };

export function pacingReducer(
  state: PacingState,
  event: PacingEvent,
): PacingState {
  switch (event.type) {
    case "armed":
      return state.phase === "arming" ? { phase: "hunting" } : state;
    case "read": {
      if (state.phase === "hunting") {
        return { phase: "tracking", code: event.code, frames: 1 };
      }
      if (state.phase !== "tracking") return state;
      if (event.code !== state.code) {
        return { phase: "tracking", code: event.code, frames: 1 };
      }
      const frames = state.frames + 1;
      return frames >= LOCK_THRESHOLD_FRAMES
        ? { phase: "scanning", code: state.code }
        : { phase: "tracking", code: state.code, frames };
    }
    case "lost":
      return state.phase === "tracking" ? { phase: "hunting" } : state;
    case "swept":
      return state.phase === "scanning"
        ? { phase: "found", code: state.code }
        : state;
    case "revealed":
      return state.phase === "found"
        ? { phase: "done", code: state.code }
        : state;
  }
}

/** How full the viewfinder's lock is, 0 to 1 (drives the corner colour). */
export function pacingConfidence(state: PacingState): number {
  switch (state.phase) {
    case "arming":
    case "hunting":
      return 0;
    case "tracking":
      return Math.min(state.frames / LOCK_THRESHOLD_FRAMES, 1);
    case "scanning":
    case "found":
    case "done":
      return 1;
  }
}

export interface PacingHint {
  title: string;
  body: string;
}

/** The words under the viewfinder for each step. */
export function pacingHint(state: PacingState): PacingHint {
  switch (state.phase) {
    case "arming":
    case "hunting":
      return {
        title: "Point the camera at a barcode",
        body: "The Coach will find the product and offer to log it.",
      };
    case "tracking":
      return { title: "Hold steady…", body: "Keep the barcode in the frame." };
    case "scanning":
      return {
        title: "Reading the barcode…",
        body: "The Coach is looking it up.",
      };
    case "found":
    case "done":
      return { title: "Got it", body: state.code };
  }
}
