import {
  ARM_MS,
  INITIAL_PACING,
  LOST_MS,
  REVEAL_MS,
  SWEEP_MS,
  pacingConfidence,
  pacingHint,
  pacingReducer,
  type PacingState,
} from "../coach-barcode-pacing-utils";
import { LOCK_THRESHOLD_FRAMES } from "@/camera/components/ScanReticle-utils";

const CODE = "4006381333931";
const OTHER = "012345678905";

function run(
  events: Parameters<typeof pacingReducer>[1][],
  from: PacingState = INITIAL_PACING,
): PacingState {
  return events.reduce(pacingReducer, from);
}

const reads = (n: number, code = CODE) =>
  Array.from({ length: n }, () => ({ type: "read" as const, code }));

describe("pacingReducer", () => {
  it("starts arming and ignores reads until armed", () => {
    expect(INITIAL_PACING).toEqual({ phase: "arming" });
    expect(run(reads(20))).toEqual({ phase: "arming" });
  });

  it("hunts once armed, then tracks the first read", () => {
    expect(run([{ type: "armed" }])).toEqual({ phase: "hunting" });
    expect(run([{ type: "armed" }, ...reads(1)])).toEqual({
      phase: "tracking",
      code: CODE,
      frames: 1,
    });
  });

  it("locks only after the same code holds for the lock threshold", () => {
    const almost = run([
      { type: "armed" },
      ...reads(LOCK_THRESHOLD_FRAMES - 1),
    ]);
    expect(almost.phase).toBe("tracking");
    expect(pacingReducer(almost, { type: "read", code: CODE })).toEqual({
      phase: "scanning",
      code: CODE,
    });
  });

  it("starts over when a different code shows up mid-hold", () => {
    const s = run([{ type: "armed" }, ...reads(5), ...reads(1, OTHER)]);
    expect(s).toEqual({ phase: "tracking", code: OTHER, frames: 1 });
  });

  it("goes back to hunting when the barcode leaves the frame", () => {
    expect(run([{ type: "armed" }, ...reads(4), { type: "lost" }])).toEqual({
      phase: "hunting",
    });
  });

  it("ignores reads and losses once it has locked", () => {
    const locked = run([{ type: "armed" }, ...reads(LOCK_THRESHOLD_FRAMES)]);
    expect(run([...reads(3, OTHER), { type: "lost" }], locked)).toEqual(locked);
  });

  it("reveals the digits after the sweep, then is done", () => {
    const locked = run([{ type: "armed" }, ...reads(LOCK_THRESHOLD_FRAMES)]);
    const found = pacingReducer(locked, { type: "swept" });
    expect(found).toEqual({ phase: "found", code: CODE });
    expect(pacingReducer(found, { type: "revealed" })).toEqual({
      phase: "done",
      code: CODE,
    });
  });

  it("ignores timer events that arrive in the wrong phase", () => {
    expect(run([{ type: "swept" }, { type: "revealed" }])).toEqual({
      phase: "arming",
    });
    const hunting = run([{ type: "armed" }]);
    expect(run([{ type: "armed" }, { type: "swept" }], hunting)).toEqual(
      hunting,
    );
  });
});

describe("pacingConfidence", () => {
  it("grows with the hold and is full from the lock on", () => {
    expect(pacingConfidence({ phase: "arming" })).toBe(0);
    expect(pacingConfidence({ phase: "hunting" })).toBe(0);
    const half = Math.ceil(LOCK_THRESHOLD_FRAMES / 2);
    expect(
      pacingConfidence({ phase: "tracking", code: CODE, frames: half }),
    ).toBeCloseTo(half / LOCK_THRESHOLD_FRAMES);
    expect(pacingConfidence({ phase: "scanning", code: CODE })).toBe(1);
    expect(pacingConfidence({ phase: "found", code: CODE })).toBe(1);
  });
});

describe("pacingHint", () => {
  it("says what is happening at each step", () => {
    expect(pacingHint({ phase: "arming" }).title).toBe(
      "Point the camera at a barcode",
    );
    expect(pacingHint({ phase: "hunting" }).title).toBe(
      "Point the camera at a barcode",
    );
    expect(pacingHint({ phase: "tracking", code: CODE, frames: 2 }).title).toBe(
      "Hold steady…",
    );
    expect(pacingHint({ phase: "scanning", code: CODE }).title).toBe(
      "Reading the barcode…",
    );
    expect(pacingHint({ phase: "found", code: CODE })).toEqual({
      title: "Got it",
      body: CODE,
    });
  });
});

describe("timings", () => {
  it("paces the scan so it is seen, without dragging", () => {
    expect(ARM_MS).toBeGreaterThanOrEqual(500);
    expect(SWEEP_MS).toBeGreaterThanOrEqual(800);
    expect(REVEAL_MS).toBeGreaterThanOrEqual(500);
    expect(ARM_MS + SWEEP_MS + REVEAL_MS).toBeLessThanOrEqual(3000);
    expect(LOST_MS).toBeGreaterThan(0);
  });
});
