// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { AiChat } from "../../server/lib/ai-client";
import { withAiCallContext } from "../../server/lib/ai-client";
import type { AiCallContext } from "../../server/lib/ai-call-context";
import type { AiFeature } from "../../server/lib/ai-models";
import { buildSmokeRequest, smokeKeysPresent, smokeRow } from "../ai-smoke";

vi.mock("../../server/lib/ai-models", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../server/lib/ai-models")>();
  return {
    ...real,
    AI_FEATURES: {
      ...real.AI_FEATURES,
      // Synthetic vertexBackup row: no real row is flagged until PR 2.
      "test-backup-row": {
        model: "openai/gpt-6-luna",
        json: false,
        vision: false,
        vertexBackup: real.VERTEX_BACKUP,
      },
    },
  };
});

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
  // Vertex counts reasoning inside max_completion_tokens: Flash at low effort
  // spent 17 of a 20-token cap on the 1×1 image and returned nothing
  // (finish "length", probe 2026-11-03); at 200 it answered.
  it("stays small but leaves room for low-effort reasoning", () => {
    const cap = buildSmokeRequest({
      model: "x/y",
      fallback: "y",
      json: false,
      vision: false,
    }).max_completion_tokens;
    expect(cap).toBeGreaterThanOrEqual(200);
    expect(cap).toBeLessThanOrEqual(256);
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
    const r = await smokeRow("photo-classify", chat as unknown as AiChat);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/unsupported parameter/);
  });
});

describe("smoke on the Vertex route", () => {
  it("smokeKeysPresent accepts Vertex vars alone, OpenRouter alone, or both", () => {
    const v = {
      GOOGLE_VERTEX_PROJECT: "p",
      GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL: "e",
      GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY: "k",
    };
    expect(smokeKeysPresent(v)).toBe(true);
    expect(smokeKeysPresent({ OPENROUTER_API_KEY: "x" })).toBe(true);
    expect(smokeKeysPresent({ ...v, OPENROUTER_API_KEY: "x" })).toBe(true);
    expect(smokeKeysPresent({})).toBe(false);
    expect(smokeKeysPresent({ GOOGLE_VERTEX_PROJECT: "p" })).toBe(false);
  });

  it("reads the provider from the call record when the reply has none (Vertex)", async () => {
    const chat = vi.fn().mockResolvedValue({
      model: "google/gemini-3.8-flash",
      choices: [{ message: { content: '{"ok":true}' } }],
    });
    const ctx: AiCallContext = {
      overrides: {},
      fallback: "off",
      calls: [
        {
          feature: "photo-analyze",
          requestedModel: "google/gemini-3.8-flash",
          answeredModel: "google/gemini-3.8-flash",
          answeredProvider: "vertex",
          fellBack: false,
        },
      ],
    };
    const r = await withAiCallContext(ctx, () =>
      smokeRow("photo-analyze", chat as unknown as AiChat),
    );
    expect(r).toMatchObject({ ok: true, answeredProvider: "vertex" });
  });

  it("accepts a bare model id answer for a google/ row", async () => {
    const chat = vi.fn().mockResolvedValue({
      model: "gemini-3.8-flash",
      choices: [{ message: { content: '{"ok":true}' } }],
    });
    expect(
      (await smokeRow("photo-analyze", chat as unknown as AiChat)).ok,
    ).toBe(true);
  });

  it("still rejects a different model", async () => {
    const chat = vi.fn().mockResolvedValue({
      model: "gpt-4o",
      choices: [{ message: { content: '{"ok":true}' } }],
    });
    expect(
      (await smokeRow("photo-analyze", chat as unknown as AiChat)).ok,
    ).toBe(false);
  });
});

describe("smoke with --backup", () => {
  const B = "test-backup-row" as unknown as AiFeature;
  const reply = (model: string) => ({
    model,
    choices: [{ message: { content: "ok" } }],
  });

  it("expects the backup model, not the row model", async () => {
    const chat = vi.fn().mockResolvedValue(reply("google/gemini-3.8-flash"));
    const r = await smokeRow(B, chat as unknown as AiChat, { backup: true });
    expect(r.ok).toBe(true);
  });

  it("an answer from the row model fails the backup smoke", async () => {
    const chat = vi.fn().mockResolvedValue(reply("openai/gpt-6-luna"));
    const r = await smokeRow(B, chat as unknown as AiChat, { backup: true });
    expect(r).toMatchObject({
      ok: false,
      detail: "answered by openai/gpt-6-luna",
    });
  });

  it("a row with no vertexBackup fails without calling the model", async () => {
    const chat = vi.fn();
    const r = await smokeRow("photo-classify", chat as unknown as AiChat, {
      backup: true,
    });
    expect(r).toMatchObject({
      ok: false,
      detail: "no vertexBackup on this row",
    });
    expect(chat).not.toHaveBeenCalled();
  });
});
