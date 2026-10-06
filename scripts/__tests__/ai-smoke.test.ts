// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { AiChat } from "../../server/lib/ai-client";
import { buildSmokeRequest, smokeRow } from "../ai-smoke";

describe("buildSmokeRequest", () => {
  it("json rows ask for json_object and say JSON in the prompt", () => {
    const req = buildSmokeRequest({
      model: "x/y",
      fallback: "y",
      json: true,
      vision: false,
    });
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(req.messages)).toMatch(/JSON/);
  });
  it("vision rows include an image_url part", () => {
    const req = buildSmokeRequest({
      model: "x/y",
      fallback: "y",
      json: false,
      vision: true,
    });
    expect(JSON.stringify(req.messages)).toContain("image_url");
  });
  it("stays tiny", () => {
    expect(
      buildSmokeRequest({
        model: "x/y",
        fallback: "y",
        json: false,
        vision: false,
      }).max_completion_tokens,
    ).toBeLessThanOrEqual(20);
  });
});

describe("smokeRow", () => {
  const completion = (content: string, model = "openai/gpt-4o-mini") => ({
    model,
    provider: "Azure",
    choices: [{ message: { content } }],
  });

  it("passes a JSON row whose reply parses", async () => {
    const chat = vi.fn().mockResolvedValue(completion('{"ok":true}'));
    const r = await smokeRow("food-nlp-parse", chat as unknown as AiChat);
    expect(r).toMatchObject({ ok: true, answeredProvider: "Azure" });
  });
  it("fails a JSON row whose reply does not parse", async () => {
    const chat = vi.fn().mockResolvedValue(completion("ok"));
    expect(
      (await smokeRow("food-nlp-parse", chat as unknown as AiChat)).ok,
    ).toBe(false);
  });
  it("fails when the call throws (fallback is off)", async () => {
    const chat = vi
      .fn()
      .mockRejectedValue(new Error("400 unsupported parameter"));
    const r = await smokeRow(
      "coach-notebook-extract",
      chat as unknown as AiChat,
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/unsupported parameter/);
  });
});
