// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createOpenRouterClient, OPENROUTER_BASE_URL } from "../ai-client";
import { AI_ROUTE_MAX_RETRIES, AI_ROUTE_TIMEOUT_MS } from "../ai-failure";

const OpenAICtor = vi.fn();
// Keeps the real error classes: ai-client / ai-failure use them at import time.
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  const ctor = vi.fn().mockImplementation(function (opts: unknown) {
    OpenAICtor(opts);
    return { chat: { completions: { create: vi.fn() } } };
  });
  return { default: Object.assign(ctor, actual.default) };
});
vi.mock("../openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../vertex-client", () => ({ createVertexClient: () => null }));
vi.mock("../error-reporter", () => ({ reportError: vi.fn() }));

describe("createOpenRouterClient", () => {
  beforeEach(() => {
    OpenAICtor.mockClear();
  });

  it("returns null when OPENROUTER_API_KEY is missing or blank", () => {
    expect(createOpenRouterClient({})).toBeNull();
    expect(createOpenRouterClient({ OPENROUTER_API_KEY: "  " })).toBeNull();
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("bounds every request with an explicit timeout and retry budget (R07)", () => {
    // Without these the SDK defaults to a 10-minute timeout x 2 retries, so a
    // stalled OpenRouter call blocks an interactive scan for ~30 minutes.
    expect(
      createOpenRouterClient({ OPENROUTER_API_KEY: "sk-or" }),
    ).not.toBeNull();
    expect(OpenAICtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-or",
        baseURL: OPENROUTER_BASE_URL,
        timeout: AI_ROUTE_TIMEOUT_MS,
        maxRetries: AI_ROUTE_MAX_RETRIES,
      }),
    );
  });
});
