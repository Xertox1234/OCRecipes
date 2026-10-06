// @vitest-environment node
import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import {
  CircuitBreaker,
  InStreamError,
  classifyAiFailure,
  countsTowardBreaker,
  isModerationBlock,
} from "../ai-failure";

const apiError = (status: number, message: string, code?: string) =>
  OpenAI.APIError.generate(
    status,
    { error: { message, code } },
    message,
    new Headers(),
  );

describe("classifyAiFailure", () => {
  it.each([
    [500, "transport"],
    [502, "transport"],
    [503, "transport"],
    [408, "transport"],
    [429, "transport"],
    [402, "balance"],
    [400, "config"],
    [404, "config"],
    [422, "config"],
  ] as const)("status %i → %s", (status, kind) => {
    expect(classifyAiFailure(apiError(status, "boom"))).toBe(kind);
  });

  it("connection errors and timeouts are transport", () => {
    expect(
      classifyAiFailure(new OpenAI.APIConnectionError({ message: "x" })),
    ).toBe("transport");
    expect(classifyAiFailure(new OpenAI.APIConnectionTimeoutError())).toBe(
      "transport",
    );
  });

  it("an in-stream error is transport", () => {
    expect(classifyAiFailure(new InStreamError({ error: {} }))).toBe(
      "transport",
    );
  });

  it.each([
    ["This model's maximum context length is 128000 tokens", undefined],
    ["prompt too long", "context_length_exceeded"],
    ["The response was filtered due to content management policy", undefined],
    ["blocked", "content_filter"],
  ])("request-content 4xx: %s → request", (message, code) => {
    expect(classifyAiFailure(apiError(400, message, code))).toBe("request");
  });

  it("OpenRouter moderation 403 is request (caused by this input)", () => {
    expect(
      classifyAiFailure(
        apiError(
          403,
          'openai/gpt-4o-mini requires moderation on OpenRouter. Your input was flagged for "harassment".',
        ),
      ),
    ).toBe("request");
  });

  it("a plain 403 without moderation text stays config", () => {
    expect(classifyAiFailure(apiError(403, "Forbidden"))).toBe("config");
  });

  it("an unknown non-API error is transport", () => {
    expect(classifyAiFailure(new Error("socket hang up"))).toBe("transport");
  });

  it("only transport and balance count toward the breaker", () => {
    expect(countsTowardBreaker("transport")).toBe(true);
    expect(countsTowardBreaker("balance")).toBe(true);
    expect(countsTowardBreaker("config")).toBe(false);
    expect(countsTowardBreaker("request")).toBe(false);
  });
});

describe("CircuitBreaker", () => {
  const make = () => {
    let t = 1_000_000;
    const clock = { advance: (ms: number) => (t += ms) };
    const breaker = new CircuitBreaker({ now: () => t });
    return { breaker, clock };
  };

  it("opens after 5 failures within 60s", () => {
    const { breaker } = make();
    for (let i = 0; i < 4; i++) breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it("failures older than the window do not count", () => {
    const { breaker, clock } = make();
    for (let i = 0; i < 4; i++) breaker.recordFailure();
    clock.advance(60_001);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it("lets a trial through after 60s; success closes it", () => {
    const { breaker, clock } = make();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    clock.advance(59_999);
    expect(breaker.isOpen()).toBe(true);
    clock.advance(1);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it("a failed trial reopens it immediately", () => {
    const { breaker, clock } = make();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    clock.advance(60_000);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });
});

describe("isModerationBlock", () => {
  it("is true for an OpenRouter moderation 403", () => {
    expect(
      isModerationBlock(
        apiError(403, "403 This model requires moderation: input was flagged"),
      ),
    ).toBe(true);
    expect(isModerationBlock(new Error("Your input was flagged"))).toBe(true);
  });

  it("is false for a plain 403", () => {
    expect(isModerationBlock(apiError(403, "Forbidden"))).toBe(false);
  });

  it("is false for a context-length 400 and for non-errors", () => {
    expect(
      isModerationBlock(apiError(400, "maximum context length exceeded")),
    ).toBe(false);
    expect(isModerationBlock("requires moderation")).toBe(false);
    expect(isModerationBlock(undefined)).toBe(false);
  });
});
