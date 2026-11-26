import {
  ARM_MS,
  INITIAL_PACING,
  LOST_MS,
  REVEAL_MS,
  SWEEP_MS,
  labelSpoken,
  labelSummary,
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

  it("reveals the digits after the sweep, then asks for the label", () => {
    const locked = run([{ type: "armed" }, ...reads(LOCK_THRESHOLD_FRAMES)]);
    const found = pacingReducer(locked, { type: "swept" });
    expect(found).toEqual({ phase: "found", code: CODE });
    expect(pacingReducer(found, { type: "revealed" })).toEqual({
      phase: "label",
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

describe("pacingReducer: the label step", () => {
  const LABEL = {
    calories: 120,
    protein: 3,
    carbs: 16,
    fat: 5,
    servingSize: "1 cup (240 ml)",
  };
  const atLabel: PacingState = { phase: "label", code: CODE };

  it("reads the photo while the sweep plays, then shows what it read", () => {
    const reading = pacingReducer(atLabel, { type: "shutter" });
    expect(reading).toEqual({ phase: "reading", code: CODE, swept: false });
    // A fast read still waits for the sweep, and the sweep for the read.
    const read = pacingReducer(reading, { type: "labelRead", label: LABEL });
    expect(read).toMatchObject({ phase: "reading" });
    const shown = pacingReducer(read, { type: "swept" });
    expect(shown).toEqual({ phase: "labelFound", code: CODE, label: LABEL });
    expect(
      run([{ type: "swept" }, { type: "labelRead", label: LABEL }], reading),
    ).toEqual(shown);
    expect(pacingReducer(shown, { type: "revealed" })).toEqual({
      phase: "done",
      code: CODE,
      label: LABEL,
    });
  });

  it("offers a retake when the label could not be read", () => {
    const failed = run(
      [
        { type: "shutter" },
        { type: "labelRead", label: null },
        { type: "swept" },
      ],
      atLabel,
    );
    expect(failed).toEqual({ phase: "unreadable", code: CODE });
    expect(pacingReducer(failed, { type: "shutter" })).toEqual({
      phase: "reading",
      code: CODE,
      swept: false,
    });
  });

  it("sends the code alone when the label is skipped", () => {
    expect(pacingReducer(atLabel, { type: "skip" })).toEqual({
      phase: "done",
      code: CODE,
    });
    expect(
      pacingReducer({ phase: "unreadable", code: CODE }, { type: "skip" }),
    ).toEqual({ phase: "done", code: CODE });
  });

  it("ignores the shutter and skip outside the label step", () => {
    const reading = pacingReducer(atLabel, { type: "shutter" });
    expect(run([{ type: "shutter" }, { type: "skip" }], reading)).toEqual(
      reading,
    );
    const hunting: PacingState = { phase: "hunting" };
    expect(run([{ type: "shutter" }, { type: "skip" }], hunting)).toEqual(
      hunting,
    );
  });

  it("ignores a label result that arrives outside a read", () => {
    expect(pacingReducer(atLabel, { type: "labelRead", label: LABEL })).toEqual(
      atLabel,
    );
  });
});

describe("pacingReducer: the front-of-pack step", () => {
  const LABEL = {
    calories: 120,
    protein: 3,
    carbs: 16,
    fat: 5,
    servingSize: "1 cup (240 ml)",
  };
  const shown: PacingState = { phase: "labelFound", code: CODE, label: LABEL };
  const atFront: PacingState = { phase: "front", code: CODE, label: LABEL };

  it("asks for the front after the label only when told it is needed", () => {
    expect(pacingReducer(shown, { type: "revealed", front: true })).toEqual(
      atFront,
    );
    expect(pacingReducer(shown, { type: "revealed" })).toEqual({
      phase: "done",
      code: CODE,
      label: LABEL,
    });
  });

  it("hands over the front photo with the code and label", () => {
    const shooting = pacingReducer(atFront, { type: "shutter" });
    expect(shooting).toEqual({ phase: "frontShot", code: CODE, label: LABEL });
    expect(
      pacingReducer(shooting, { type: "frontTaken", uri: "file:///f.jpg" }),
    ).toEqual({
      phase: "done",
      code: CODE,
      label: LABEL,
      frontUri: "file:///f.jpg",
    });
  });

  it("goes back to the front step when the photo could not be taken", () => {
    const shooting = pacingReducer(atFront, { type: "shutter" });
    expect(pacingReducer(shooting, { type: "frontTaken", uri: null })).toEqual(
      atFront,
    );
  });

  it("sends the code and label alone when the front is skipped", () => {
    expect(pacingReducer(atFront, { type: "skip" })).toEqual({
      phase: "done",
      code: CODE,
      label: LABEL,
    });
  });

  it("ignores a photo that arrives outside the front step", () => {
    expect(
      pacingReducer(atFront, { type: "frontTaken", uri: "file:///f.jpg" }),
    ).toEqual(atFront);
  });

  it("says what the front step is for", () => {
    expect(pacingHint(atFront).title).toBe("Add the front of the pack?");
    expect(pacingHint(atFront).body).toMatch(/name it/i);
    expect(pacingHint(atFront).body).toMatch(/allerg/i);
  });
});

describe("labelSummary / labelSpoken", () => {
  const noisy = {
    calories: 123.456,
    protein: 3.333,
    carbs: 16,
    fat: 0.05,
    servingSize: "1 bar",
  };
  it("rounds to one decimal and says it is per serving", () => {
    expect(labelSummary(noisy)).toBe(
      "Per serving: 123.5 cal · 3.3 g protein · 16 g carbs · 0.1 g fat",
    );
    expect(labelSpoken(noisy)).toBe(
      "Per serving: 123.5 calories, 3.3 grams protein, 16 grams carbs, 0.1 grams fat.",
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
    expect(pacingHint({ phase: "label", code: CODE }).title).toBe(
      "Now the nutrition label",
    );
    expect(
      pacingHint({ phase: "reading", code: CODE, swept: false }).title,
    ).toBe("Reading the label…");
    expect(pacingHint({ phase: "unreadable", code: CODE }).title).toBe(
      "I couldn't read that label",
    );
    expect(
      pacingHint({
        phase: "labelFound",
        code: CODE,
        label: {
          calories: 120,
          protein: 3,
          carbs: 16,
          fat: 5,
          servingSize: "1 cup (240 ml)",
        },
      }),
    ).toEqual({
      title: "Got the label",
      body: "Per serving: 120 cal · 3 g protein · 16 g carbs · 5 g fat",
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
