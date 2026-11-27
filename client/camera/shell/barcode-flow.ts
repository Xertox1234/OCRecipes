// client/camera/shell/barcode-flow.ts
import type { FrameShape } from "../components/ScanReticle-utils";
import type { ScanPhase } from "../types/scan-phase";
import type { ScanExampleKey } from "@/lib/feature-tips-storage";

export type StepTabState = "upcoming" | "active" | "done";

export interface StepTabView {
  id: "barcode" | "nutrition" | "front";
  label: string;
  sublabel?: string;
  state: StepTabState;
  tappable: boolean;
}

export interface FlowView {
  tabs: StepTabView[];
  frame: FrameShape;
  hint: string;
  showShutter: boolean;
  showSkip: boolean;
  exampleKey: ScanExampleKey | null;
}

const HINT_BARCODE = "Line the barcode up inside the frame";
const HINT_LABEL = "Fit the whole panel in the frame";
const HINT_FRONT = "Fit the front of the package in the frame";

type TabStates = [StepTabState, StepTabState, StepTabState];

function buildTabs(
  states: TabStates,
  tappable: [boolean, boolean, boolean],
  returnAfterLog: boolean,
): StepTabView[] {
  const all: StepTabView[] = [
    {
      id: "barcode",
      label: "Barcode",
      state: states[0],
      tappable: tappable[0],
    },
    {
      id: "nutrition",
      label: "Nutrition",
      state: states[1],
      tappable: tappable[1],
    },
    {
      id: "front",
      label: "Front",
      sublabel: "optional",
      state: states[2],
      tappable: tappable[2],
    },
  ];
  return returnAfterLog ? all.slice(0, 1) : all;
}

const NO_TAP: [boolean, boolean, boolean] = [false, false, false];

/**
 * What the camera shell shows for a scan phase. Phases with no live camera
 * step (locked, reviewing, complete) show the step they belong to, with no
 * shutter, skip or tappable tabs. Smart-scan phases are unreachable from the
 * barcode flow; they map to the generic single-step view.
 */
export function getBarcodeFlowView(
  phase: ScanPhase,
  opts: { returnAfterLog: boolean },
): FlowView {
  const { returnAfterLog } = opts;
  switch (phase.type) {
    case "IDLE":
    case "HUNTING":
    case "BARCODE_TRACKING":
    case "BARCODE_LOCKED":
      return {
        tabs: buildTabs(
          ["active", "upcoming", "upcoming"],
          NO_TAP,
          returnAfterLog,
        ),
        frame: "barcode",
        hint: HINT_BARCODE,
        showShutter: false,
        showSkip: false,
        exampleKey: phase.type === "BARCODE_LOCKED" ? null : "barcode",
      };
    case "LABEL_PROMPTED":
      return {
        tabs: buildTabs(
          ["done", "active", "upcoming"],
          [true, false, false],
          returnAfterLog,
        ),
        frame: "label",
        hint: HINT_LABEL,
        showShutter: true,
        showSkip: true,
        exampleKey: "barcode-nutrition",
      };
    case "STEP2_REVIEWING":
      return {
        tabs: buildTabs(["done", "active", "upcoming"], NO_TAP, returnAfterLog),
        frame: "label",
        hint: HINT_LABEL,
        showShutter: false,
        showSkip: false,
        exampleKey: null,
      };
    case "STEP2_CONFIRMED":
      return {
        tabs: buildTabs(
          // A skipped nutrition step is not a check mark, but can be retaken.
          ["done", phase.nutritionImageUri ? "done" : "upcoming", "active"],
          [true, true, false],
          returnAfterLog,
        ),
        frame: "front",
        hint: HINT_FRONT,
        showShutter: true,
        showSkip: true,
        exampleKey: "barcode-front",
      };
    case "STEP3_REVIEWING":
      return {
        tabs: buildTabs(
          ["done", phase.nutritionImageUri ? "done" : "upcoming", "active"],
          NO_TAP,
          returnAfterLog,
        ),
        frame: "front",
        hint: HINT_FRONT,
        showShutter: false,
        showSkip: false,
        exampleKey: null,
      };
    case "SESSION_COMPLETE":
      return {
        tabs: buildTabs(
          // A skipped step is not a check mark (as on the earlier phases).
          [
            "done",
            phase.nutritionImageUri ? "done" : "upcoming",
            phase.frontImageUri ? "done" : "upcoming",
          ],
          NO_TAP,
          returnAfterLog,
        ),
        frame: "front",
        hint: HINT_FRONT,
        showShutter: false,
        showSkip: false,
        exampleKey: null,
      };
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return {
        tabs: [],
        frame: "photo",
        hint: "",
        showShutter: true,
        showSkip: false,
        exampleKey: null,
      };
  }
}

/**
 * Photo URIs to delete when the user commits to a DIFFERENT product after a
 * redo-barcode detour: the found card for it carried the old steps
 * (`resume`) so "Not this" could bring them back, and moving on from it in
 * any forward direction means photos of the old product must never reach the
 * new one. Not this (HUNTING), a product load (still locked) and leaving the
 * screen (IDLE — the abandon clean-up deletes them) discard nothing here.
 */
export function getPhotosDiscardedByCommit(
  prev: ScanPhase,
  next: ScanPhase,
): string[] {
  if (prev.type !== "BARCODE_LOCKED" || !prev.resume) return [];
  switch (next.type) {
    case "LABEL_PROMPTED":
    case "STEP2_REVIEWING":
    case "SESSION_COMPLETE":
      break;
    case "IDLE":
    case "HUNTING":
    case "BARCODE_TRACKING":
    case "BARCODE_LOCKED":
    case "STEP2_CONFIRMED":
    case "STEP3_REVIEWING":
    case "CLASSIFYING":
    case "SMART_CONFIRMED":
    case "SMART_ERROR":
      return [];
  }
  const resume = prev.resume;
  switch (resume.type) {
    case "STEP2_CONFIRMED":
      return resume.nutritionImageUri ? [resume.nutritionImageUri] : [];
    case "LABEL_PROMPTED":
      return [];
  }
}
