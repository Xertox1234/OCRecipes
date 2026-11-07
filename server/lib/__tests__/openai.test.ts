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
    expect(mod.isAiConfigured).toBe(false);
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("constructs nothing at import even when a key is present", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "sk-test-key";
    const mod = await load();
    expect(mod.isAiConfigured).toBe(true);
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("getOpenAI throws a clear error when unconfigured, with no placeholder client", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "";
    const mod = await load();
    expect(mod.isAiConfigured).toBe(false);
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
