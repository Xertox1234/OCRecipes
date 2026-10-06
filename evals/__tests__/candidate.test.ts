import { describe, it, expect } from "vitest";
import {
  checkCallRecords,
  modelMatches,
  parseCandidate,
  unusedOverrides,
} from "../lib/candidate";
import type { AiCallRecord } from "../../server/lib/ai-call-context";

describe("parseCandidate", () => {
  it("parses entries with typed set values", () => {
    expect(
      parseCandidate(
        "coach-chat=openai/gpt-6-luna;reasoning_effort=low;top_p=0.9,photo-analyze=google/gemini-3.8-flash",
      ),
    ).toEqual({
      "coach-chat": {
        model: "openai/gpt-6-luna",
        set: { reasoning_effort: "low", top_p: 0.9 },
      },
      "photo-analyze": { model: "google/gemini-3.8-flash" },
    });
  });
  it("rejects an unknown feature", () => {
    expect(() => parseCandidate("nope=openai/x")).toThrow(
      /unknown feature "nope"/,
    );
  });
  it("rejects a provider with no pinned OpenRouter host", () => {
    expect(() =>
      parseCandidate("coach-chat=anthropic/claude-sonnet-4.6"),
    ).toThrow(/no pinned OpenRouter host/);
  });
  it("rejects a model without a provider prefix", () => {
    expect(() => parseCandidate("coach-chat=gpt-6-luna")).toThrow(
      /provider\/model/,
    );
  });
  it("rejects an empty spec", () => {
    expect(() => parseCandidate("")).toThrow();
  });
});

describe("modelMatches", () => {
  it("dated answered model matches requested", () => {
    expect(
      modelMatches("openai/gpt-4o-mini", "openai/gpt-4o-mini-2024-07-18"),
    ).toBe(true);
    expect(modelMatches("openai/gpt-4o-mini", "openai/gpt-4o-mini")).toBe(true);
  });
  it("compact YYYYMMDD date suffix matches", () => {
    expect(
      modelMatches("openai/gpt-4o-mini", "openai/gpt-4o-mini-20240718"),
    ).toBe(true);
  });
  it("a non-date suffix does not match", () => {
    expect(
      modelMatches("openai/gpt-4o-mini", "openai/gpt-4o-mini-preview"),
    ).toBe(false);
  });
  it("a different model does not match", () => {
    expect(modelMatches("openai/gpt-4o", "openai/gpt-4o-mini")).toBe(false);
    expect(modelMatches("openai/gpt-6-luna", null)).toBe(false);
  });
});

const rec = (over: Partial<AiCallRecord> = {}): AiCallRecord => ({
  feature: "coach-chat",
  requestedModel: "openai/gpt-6-luna",
  answeredModel: "openai/gpt-6-luna",
  answeredProvider: "Azure",
  fellBack: false,
  ...over,
});
const overrides = { "coach-chat": { model: "openai/gpt-6-luna" } } as const;

describe("checkCallRecords", () => {
  it("a clean candidate sample has no violations", () => {
    expect(checkCallRecords([rec()], overrides)).toEqual([]);
  });
  it("zero recorded calls is a violation", () => {
    expect(checkCallRecords([], overrides)).toEqual([
      expect.stringMatching(/no AI calls recorded/),
    ]);
  });
  it("requested model not the candidate", () => {
    expect(
      checkCallRecords(
        [
          rec({
            requestedModel: "openai/gpt-4o-mini",
            answeredModel: "openai/gpt-4o-mini",
          }),
        ],
        overrides,
      )[0],
    ).toMatch(/requested openai\/gpt-4o-mini, expected openai\/gpt-6-luna/);
  });
  it("answered model differs from requested", () => {
    expect(
      checkCallRecords(
        [rec({ answeredModel: "openai/gpt-4o-mini" })],
        overrides,
      )[0],
    ).toMatch(/answered by/);
  });
  it("fell back", () => {
    expect(
      checkCallRecords([rec({ fellBack: true })], overrides).join(),
    ).toMatch(/fell back/);
  });
  it("baseline (no overrides) checks against the table model", () => {
    expect(
      checkCallRecords(
        [
          rec({
            requestedModel: "openai/gpt-4o-mini",
            answeredModel: "openai/gpt-4o-mini",
          }),
        ],
        {},
      ),
    ).toEqual([]);
  });
});

describe("unusedOverrides", () => {
  const rec = (feature: AiCallRecord["feature"]): AiCallRecord => ({
    feature,
    requestedModel: "m/x",
    answeredModel: "m/x",
    answeredProvider: null,
    fellBack: false,
  });

  it("returns override features no sample called", () => {
    expect(
      unusedOverrides(
        {
          "coach-chat": { model: "a/b" },
          "photo-analyze": { model: "a/b" },
        },
        [[rec("coach-chat")], []],
      ),
    ).toEqual(["photo-analyze"]);
  });

  it("counts a feature called by any sample as used", () => {
    expect(
      unusedOverrides({ "coach-chat": { model: "a/b" } }, [
        [],
        [rec("coach-chat")],
      ]),
    ).toEqual([]);
  });

  it("returns [] when there are no overrides", () => {
    expect(unusedOverrides({}, [[rec("coach-chat")]])).toEqual([]);
  });
});
