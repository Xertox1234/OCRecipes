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

  // The chat services swallow an aiChat error into an apology reply, and a
  // failed Vertex backup call records nothing — text alone is not success.
  it("reports a backup sample with no recorded call (error swallowed into an apology)", () => {
    expect(
      gateProblems(
        sample({ calls: [], text: "Sorry, I'm having trouble responding" }),
      ),
    ).toContain("no AI call recorded");
  });

  // 14 text rows catch a bad reply (e.g. JSON they cannot parse) and return a
  // stand-in value; the call record looks clean, so the driver must say so.
  it("reports a sample whose service returned its fallback value", () => {
    expect(
      gateProblems(sample({ degraded: "returned FALLBACK_QUESTIONS" })),
    ).toContain("fallback value: returned FALLBACK_QUESTIONS");
  });

  it("reports a recorded call error even when the service replied", () => {
    const failed = call({
      answeredModel: null,
      answeredProvider: null,
      finishReason: undefined,
      error: {
        kind: "request",
        moderated: false,
        message: "400 bad tool history",
      },
    });
    expect(
      gateProblems(
        sample({
          feature: "coach-pro-chat",
          mode: "switch-vertex-then-or",
          calls: [call(), failed],
          text: "Sorry, I'm having trouble responding",
          toolRounds: 1,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        "call error: 400 bad tool history",
        "route pair wrong",
      ]),
    );
  });

  it("reports a successful call with no finish_reason (stream cut off)", () => {
    expect(
      gateProblems(sample({ calls: [call({ finishReason: null })] })),
    ).toContain("no finish_reason");
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
