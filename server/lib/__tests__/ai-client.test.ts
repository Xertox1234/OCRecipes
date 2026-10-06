// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import OpenAI from "openai";
import { createAiChat, withAiCallContext } from "../ai-client";
import type { AiChatDeps } from "../ai-client";
import { CircuitBreaker } from "../ai-failure";
import type { AiCallContext } from "../ai-call-context";

vi.mock("../logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));
vi.mock("../error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("../openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

const completion = (model: string, provider?: string) => ({
  id: "c1",
  object: "chat.completion",
  created: 0,
  model,
  provider,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hi" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
    cost: 0.0001,
  },
});

const apiError = (status: number, message = "boom") =>
  OpenAI.APIError.generate(
    status,
    { error: { message } },
    message,
    new Headers(),
  );

function makeDeps(overrides: Partial<AiChatDeps> = {}) {
  const deps: AiChatDeps = {
    openrouter: { chat: { completions: { create: vi.fn() } } },
    fallback: { chat: { completions: { create: vi.fn() } } },
    breaker: new CircuitBreaker(),
    report: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  return deps;
}

const params = {
  messages: [{ role: "user" as const, content: "hello" }],
  temperature: 0.5,
  max_completion_tokens: 50,
};

describe("aiChat (non-streaming)", () => {
  let deps: AiChatDeps;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("no OpenRouter key → today's client, fallback model, original params", async () => {
    deps = makeDeps({ openrouter: null });
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("coach-notebook-extract", params, { timeout: 15_000 });
    expect(deps.fallback.chat.completions.create).toHaveBeenCalledWith(
      { ...params, model: "gpt-4o-mini" },
      { timeout: 15_000 },
    );
  });

  it("key set → OpenRouter with the row model, zdr, adapted params", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini", "Azure"),
    );
    const aiChat = createAiChat(deps);
    const res = await aiChat("coach-notebook-extract", params);
    expect(res.model).toBe("openai/gpt-4o-mini");
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      { ...params, model: "openai/gpt-4o-mini", provider: { zdr: true } },
      undefined,
    );
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(503), "transport", true],
    [apiError(429), "transport", true],
    [new OpenAI.APIConnectionTimeoutError(), "transport", true],
    [apiError(402), "balance", true],
    [apiError(400, "unsupported parameter: temperature"), "config", false],
    [apiError(400, "maximum context length exceeded"), "request", false],
  ] as const)(
    "failure %# → fallback with ORIGINAL params (%s)",
    async (err, kind, counts) => {
      vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
        err,
      );
      vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
        completion("gpt-4o-mini"),
      );
      const spy = vi.spyOn(deps.breaker, "recordFailure");
      const aiChat = createAiChat(deps);
      await aiChat("coach-notebook-extract", params);
      expect(deps.fallback.chat.completions.create).toHaveBeenCalledWith(
        { ...params, model: "gpt-4o-mini" },
        undefined,
      );
      expect(spy).toHaveBeenCalledTimes(counts ? 1 : 0);
      expect(deps.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: "coach-notebook-extract",
          fallbackReason: kind,
        }),
        expect.any(String),
      );
    },
  );

  it("402 raises the balance alert; config 4xx raises the config alert; request 4xx raises none", async () => {
    const aiChat = createAiChat(deps);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const create = vi.mocked(deps.openrouter!.chat.completions.create);

    create.mockRejectedValueOnce(apiError(402));
    await aiChat("coach-notebook-extract", params);
    expect(vi.mocked(deps.report).mock.calls.at(-1)![0].message).toMatch(
      /balance exhausted/i,
    );

    create.mockRejectedValueOnce(apiError(400, "unknown model"));
    await aiChat("coach-notebook-extract", params);
    expect(vi.mocked(deps.report).mock.calls.at(-1)![0].message).toMatch(
      /AI config error: coach-notebook-extract/,
    );

    vi.mocked(deps.report).mockClear();
    create.mockRejectedValueOnce(apiError(400, "content_filter triggered"));
    await aiChat("coach-notebook-extract", params);
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("an aborted call re-throws without fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      new OpenAI.APIUserAbortError(),
    );
    const aiChat = createAiChat(deps);
    await expect(
      aiChat("coach-notebook-extract", params, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OpenAI.APIUserAbortError);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("an open breaker skips OpenRouter entirely", async () => {
    for (let i = 0; i < 5; i++) deps.breaker.recordFailure();
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("coach-notebook-extract", params);
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: "circuit-open" }),
      expect.any(String),
    );
  });

  it("success logs feature, requested/answered model, provider and cost", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini", "Azure"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("coach-notebook-extract", params);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "coach-notebook-extract",
        provider: "openrouter",
        requestedModel: "openai/gpt-4o-mini",
        answeredModel: "openai/gpt-4o-mini",
        answeredProvider: "Azure",
        cost: 0.0001,
      }),
      expect.any(String),
    );
  });
});

describe("aiChat inside a call context", () => {
  const ctx = (over: Partial<AiCallContext> = {}): AiCallContext => ({
    overrides: {},
    fallback: "off",
    calls: [],
    ...over,
  });

  it("applies the override model + set and records the call", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-6-luna", "Azure"),
    );
    const aiChat = createAiChat(deps);
    const c = ctx({
      overrides: {
        "coach-notebook-extract": {
          model: "openai/gpt-6-luna",
          set: { reasoning_effort: "low" },
        },
      },
    });
    await withAiCallContext(c, () => aiChat("coach-notebook-extract", params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-6-luna",
        reasoning_effort: "low",
      }),
      undefined,
    );
    expect(c.calls).toEqual([
      {
        feature: "coach-notebook-extract",
        requestedModel: "openai/gpt-6-luna",
        answeredModel: "openai/gpt-6-luna",
        answeredProvider: "Azure",
        fellBack: false,
      },
    ]);
  });

  it("fallback off → an OpenRouter failure throws (no silent fallback)", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    const aiChat = createAiChat(deps);
    await expect(
      withAiCallContext(ctx(), () => aiChat("coach-notebook-extract", params)),
    ).rejects.toThrow();
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("fallback off with no key throws a clear error", async () => {
    const deps = makeDeps({ openrouter: null });
    const aiChat = createAiChat(deps);
    await expect(
      withAiCallContext(ctx(), () => aiChat("coach-notebook-extract", params)),
    ).rejects.toThrow(/OPENROUTER_API_KEY is required when fallback is off/);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("fallback off ignores an open breaker (eval runs always hit OpenRouter)", async () => {
    const deps = makeDeps();
    for (let i = 0; i < 5; i++) deps.breaker.recordFailure();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await withAiCallContext(ctx(), () =>
      aiChat("coach-notebook-extract", params),
    );
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalled();
  });

  it("overrides apply even under NODE_ENV=production (aiChat never reads NODE_ENV)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-6-luna"),
    );
    const aiChat = createAiChat(deps);
    const c = ctx({
      overrides: { "coach-notebook-extract": { model: "openai/gpt-6-luna" } },
    });
    await withAiCallContext(c, () => aiChat("coach-notebook-extract", params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-6-luna" }),
      undefined,
    );
    vi.unstubAllEnvs();
  });

  it("no context → no overrides applied and nothing recorded", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("coach-notebook-extract", params);
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-4o-mini" }),
      undefined,
    );
  });
});
