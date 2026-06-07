// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Reloads the module fresh so the apiKey is re-read from process.env each time.
async function load() {
  vi.resetModules();
  return await import("../openai");
}

describe("openai client init", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
  });
  afterEach(() => {
    process.env = saved;
  });

  it("does not throw at import when the API key is unset (AI is optional)", async () => {
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    // A throw here would crash server boot — the placeholder fallback prevents it.
    const mod = await load();
    expect(mod.isAiConfigured).toBe(false);
    expect(mod.openai).toBeDefined();
    expect(mod.dalleClient).toBeDefined();
  });

  it("does not throw when the API key is an empty string", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "";
    const mod = await load();
    expect(mod.isAiConfigured).toBe(false);
    expect(mod.openai).toBeDefined();
  });

  it("reports configured when a key is present", async () => {
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "sk-test-key";
    const mod = await load();
    expect(mod.isAiConfigured).toBe(true);
    expect(mod.openai).toBeDefined();
  });
});
