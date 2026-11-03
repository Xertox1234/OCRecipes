import { describe, it, expect } from "vitest";
import { gateProblems } from "../ai-backup-gate";
import type { GateSample } from "../ai-backup-gate";
import type { AiCallRecord } from "../../server/lib/ai-call-context";

const call = (over: Partial<AiCallRecord> = {}): AiCallRecord => ({
  feature: "recipe-generate",
  requestedModel: "google/gemini-4-argon",
  answeredModel: "google/gemini-3.8-flash",
  answeredProvider: "vertex",
  fellBack: true,
  finishReason: "stop",
  ...over,
});

const sample = (over: Partial<GateSample> = {}): GateSample => ({
  feature: "recipe-generate",
  mode: "backup",
  calls: [call()],
  text: '{"title":"Tofu bowl"}',
  toolRounds: 0,
  latencyMs: 1200,
  ...over,
});

const or = (over: Partial<AiCallRecord> = {}) =>
  call({ answeredProvider: "Azure", fellBack: false, ...over });

describe("gateProblems", () => {
  it("a clean backup sample has no problems", () => {
    expect(gateProblems(sample())).toEqual([]);
  });

  it("reports the error of a failed sample (e.g. a 400)", () => {
    expect(
      gateProblems(sample({ calls: [], text: "", error: "400 bad schema" })),
    ).toContain("400 bad schema");
  });

  it("reports a length finish", () => {
    expect(
      gateProblems(sample({ calls: [call({ finishReason: "length" })] })),
    ).toContain("length finish");
  });

  it("reports a reply with no text", () => {
    expect(gateProblems(sample({ text: "  " }))).toContain("no text");
  });

  it("reports a backup sample answered off the Vertex route", () => {
    expect(gateProblems(sample({ calls: [or()] }))).toContain(
      "left the backup route",
    );
  });

  it("reports a switch sample with no tool round", () => {
    expect(
      gateProblems(
        sample({
          feature: "coach-pro-chat",
          mode: "switch-or-then-vertex",
          calls: [or()],
          toolRounds: 0,
        }),
      ),
    ).toContain("no tool round — switch not exercised");
  });

  it("reports a switch sample whose first two routes are not the intended pair", () => {
    const wrongPair = { calls: [call(), call()], toolRounds: 1 };
    expect(
      gateProblems(
        sample({
          feature: "coach-pro-chat",
          mode: "switch-or-then-vertex",
          ...wrongPair,
        }),
      ),
    ).toContain("route pair wrong");
    expect(
      gateProblems(
        sample({
          feature: "coach-pro-chat",
          mode: "switch-vertex-then-or",
          calls: [call(), or()],
          toolRounds: 1,
        }),
      ),
    ).toEqual([]);
  });
});
