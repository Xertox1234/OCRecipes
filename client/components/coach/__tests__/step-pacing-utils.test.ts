import { describe, it, expect } from "vitest";
import {
  enqueueStep,
  initialStepQueue,
  stepsSettled,
  tickSteps,
} from "../step-pacing-utils";

const MIN = 1000;
const label = (q: ReturnType<typeof initialStepQueue>) =>
  q.current?.label ?? null;

describe("step pacing queue (show-the-work spec 2026-11-09)", () => {
  it("a single step holds 1000 ms then clears", () => {
    let q = enqueueStep(initialStepQueue(), "A");
    q = tickSteps(q, 0, MIN);
    expect(label(q)).toBe("A");
    q = tickSteps(q, 999, MIN);
    expect(label(q)).toBe("A");
    expect(stepsSettled(q, 999, MIN)).toBe(false);
    q = tickSteps(q, 1000, MIN);
    expect(label(q)).toBeNull();
    expect(stepsSettled(q, 1000, MIN)).toBe(true);
  });

  it("three steps play in order, each a full 1000 ms", () => {
    let q = initialStepQueue();
    for (const l of ["A", "B", "C"]) q = enqueueStep(q, l);
    const seen: (string | null)[] = [];
    for (const t of [0, 999, 1000, 1999, 2000, 2999]) {
      q = tickSteps(q, t, MIN);
      seen.push(label(q));
    }
    expect(seen).toEqual(["A", "A", "B", "B", "C", "C"]);
    expect(stepsSettled(q, 2999, MIN)).toBe(false);
    q = tickSteps(q, 3000, MIN);
    expect(label(q)).toBeNull();
    expect(stepsSettled(q, 3000, MIN)).toBe(true);
  });

  it("a step enqueued while another shows waits its turn", () => {
    let q = tickSteps(enqueueStep(initialStepQueue(), "A"), 0, MIN);
    q = enqueueStep(q, "B");
    q = tickSteps(q, 500, MIN);
    expect(label(q)).toBe("A");
    q = tickSteps(q, 1000, MIN);
    expect(label(q)).toBe("B");
  });

  it("a step queued but not yet ticked is not settled", () => {
    const q = enqueueStep(initialStepQueue(), "A");
    expect(stepsSettled(q, 0, MIN)).toBe(false);
  });

  it("an empty queue is settled immediately", () => {
    expect(stepsSettled(initialStepQueue(), 0, MIN)).toBe(true);
  });
});
