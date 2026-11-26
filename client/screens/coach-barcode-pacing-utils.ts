// client/screens/coach-barcode-pacing-utils.ts
/**
 * Pacing for the Coach's live barcode scanner, so a scan reads as a scan and
 * not as a surprise: the viewfinder settles before it listens, the corners
 * fill in while the same code holds, a sweep plays, and the digits show.
 *
 * Then the label step: the user photographs the nutrition label (or skips
 * it), the phone reads it while a sweep plays, and the numbers show before
 * the screen closes and hands the code and the label to the chat.
 */
import { LOCK_THRESHOLD_FRAMES } from "@/camera/components/ScanReticle-utils";
import type { PhoneLabelRead } from "@/lib/coach-label-pre-read";

/** The viewfinder settles before it reads: nothing fires as the camera opens. */
export const ARM_MS = 700;
/** No read for this long while holding: the barcode left the frame. */
export const LOST_MS = 450;
/** The scanning sweep: over the barcode at the lock, over the label as it is read. */
export const SWEEP_MS = 1100;
/** The digits stay up this long before the screen closes. */
export const REVEAL_MS = 800;

export type PacingState =
  | { phase: "arming" }
  | { phase: "hunting" }
  | { phase: "tracking"; code: string; frames: number }
  | { phase: "scanning"; code: string }
  | { phase: "found"; code: string }
  /** Waiting for the label photo. */
  | { phase: "label"; code: string }
  /** The label photo is being read; `read` is set once the reader answers. */
  | {
      phase: "reading";
      code: string;
      swept: boolean;
      read?: PhoneLabelRead | null;
    }
  | { phase: "unreadable"; code: string }
  | { phase: "labelFound"; code: string; label: PhoneLabelRead }
  /** Hand `code` (and `label`, unless skipped) to the chat and close. */
  | { phase: "done"; code: string; label?: PhoneLabelRead };

export type PacingEvent =
  | { type: "armed" }
  /** A valid product code on one camera frame. */
  | { type: "read"; code: string }
  | { type: "lost" }
  | { type: "swept" }
  | { type: "revealed" }
  /** The label photo was taken. */
  | { type: "shutter" }
  /** The phone's reader answered: the label's numbers, or null. */
  | { type: "labelRead"; label: PhoneLabelRead | null }
  /** Send the code without a label. */
  | { type: "skip" };

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
      if (state.phase === "scanning")
        return { phase: "found", code: state.code };
      return state.phase === "reading"
        ? settleRead({ ...state, swept: true })
        : state;
    case "revealed":
      if (state.phase === "found") return { phase: "label", code: state.code };
      return state.phase === "labelFound"
        ? { phase: "done", code: state.code, label: state.label }
        : state;
    case "shutter":
      return state.phase === "label" || state.phase === "unreadable"
        ? { phase: "reading", code: state.code, swept: false }
        : state;
    case "labelRead":
      return state.phase === "reading" && !("read" in state)
        ? settleRead({ ...state, read: event.label })
        : state;
    case "skip":
      return state.phase === "label" || state.phase === "unreadable"
        ? { phase: "done", code: state.code }
        : state;
  }
}

/** A read shows its outcome once both the sweep and the reader are done. */
function settleRead(
  state: Extract<PacingState, { phase: "reading" }>,
): PacingState {
  if (!state.swept || !("read" in state) || state.read === undefined) {
    return state;
  }
  return state.read
    ? { phase: "labelFound", code: state.code, label: state.read }
    : { phase: "unreadable", code: state.code };
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
    case "label":
    case "reading":
    case "unreadable":
    case "labelFound":
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
        body: "Checking the code.",
      };
    case "found":
      return { title: "Got it", body: state.code };
    case "label":
      return {
        title: "Now the nutrition label",
        body: "Fit the Nutrition Facts panel in the frame and take the photo.",
      };
    case "reading":
      return {
        title: "Reading the label…",
        body: "On your phone: the photo isn't sent.",
      };
    case "unreadable":
      return {
        title: "I couldn't read that label",
        body: "Try it flat and in good light, or skip it.",
      };
    case "labelFound":
    case "done":
      return state.label
        ? { title: "Got the label", body: labelSummary(state.label) }
        : { title: "Got it", body: state.code };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The label's numbers, short: "Per serving: 120 cal · 3 g protein · …". */
export function labelSummary(label: PhoneLabelRead): string {
  return (
    "Per serving: " +
    [
      `${round1(label.calories)} cal`,
      `${round1(label.protein)} g protein`,
      `${round1(label.carbs)} g carbs`,
      `${round1(label.fat)} g fat`,
    ].join(" · ")
  );
}

/** The same numbers in words, for VoiceOver. */
export function labelSpoken(label: PhoneLabelRead): string {
  return (
    `Per serving: ${round1(label.calories)} calories, ` +
    `${round1(label.protein)} grams protein, ` +
    `${round1(label.carbs)} grams carbs, ` +
    `${round1(label.fat)} grams fat.`
  );
}
