// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const OpenAICtor = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function (opts: unknown) {
    OpenAICtor(opts);
    return { audio: {} };
  }),
}));

// Reloads the module fresh so the apiKey is re-read from process.env each time.
async function load() {
  vi.resetModules();
  return await import("../openai");
}

describe("openai client init", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    OpenAICtor.mockClear();
  });
  afterEach(() => {
    process.env = saved;
  });

  it("constructs nothing at import when the API key is unset (AI is optional)", async () => {
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const mod = await load();
    expect(mod.isOpenAIDirectConfigured).toBe(false);
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("constructs nothing at import even when a key is present", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "sk-test-key";
    const mod = await load();
    expect(mod.isOpenAIDirectConfigured).toBe(true);
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("getOpenAI throws a clear error when unconfigured, with no placeholder client", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "";
    const mod = await load();
    expect(mod.isOpenAIDirectConfigured).toBe(false);
    expect(() => mod.getOpenAI()).toThrow(/not configured/i);
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("getOpenAI builds the client once, on first use, from env at that moment", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "sk-test-key";
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "http://127.0.0.1:4010/v1";
    const mod = await load();
    const a = mod.getOpenAI();
    const b = mod.getOpenAI();
    expect(a).toBe(b);
    expect(OpenAICtor).toHaveBeenCalledTimes(1);
    expect(OpenAICtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test-key",
        baseURL: "http://127.0.0.1:4010/v1",
      }),
    );
  });
});

// Reliability audit 2026-11-19 M-rel-3: every chat/vision AI call goes through
// aiChat (OpenRouter, or Vertex direct). The route guard read only the retired
// OpenAI-direct key, so it 503'd every AI route when that key was dropped and
// let them through to a 500 when it was set but no aiChat route existed.
describe("isAiConfigured = an aiChat route exists (M-rel-3)", () => {
  const saved = { ...process.env };
  const VERTEX = {
    GOOGLE_VERTEX_PROJECT: "oc-vision",
    GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL: "ai@oc-vision.iam.gserviceaccount.com",
    GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY: "pem",
  };
  beforeEach(() => {
    process.env = { ...saved };
    for (const k of [
      "AI_INTEGRATIONS_OPENAI_API_KEY",
      "OPENROUTER_API_KEY",
      ...Object.keys(VERTEX),
    ])
      delete process.env[k];
  });
  afterEach(() => {
    process.env = saved;
  });

  it("is false with only the legacy OpenAI-direct key", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "sk-test-key";
    expect((await load()).isAiConfigured).toBe(false);
  });

  it("is true with an OpenRouter key and no legacy key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect((await load()).isAiConfigured).toBe(true);
  });

  it("is false with a blank OpenRouter key", async () => {
    process.env.OPENROUTER_API_KEY = "  ";
    expect((await load()).isAiConfigured).toBe(false);
  });

  it("is true with the full Vertex set and nothing else", async () => {
    Object.assign(process.env, VERTEX);
    expect((await load()).isAiConfigured).toBe(true);
  });

  it.each(Object.keys(VERTEX))(
    "is false when the Vertex set is missing %s",
    async (missing) => {
      Object.assign(process.env, VERTEX);
      delete process.env[missing];
      expect((await load()).isAiConfigured).toBe(false);
    },
  );
});
