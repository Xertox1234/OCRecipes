// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import OpenAI from "openai";
import { createAiChat, withAiCallContext } from "../ai-client";
import type { AiChatDeps } from "../ai-client";
import { CircuitBreaker } from "../ai-failure";
import type { AiCallContext } from "../ai-call-context";
import { AI_FEATURES } from "../ai-models";

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

  it("key set → OpenRouter with the row model, zdr, pinned host, adapted params", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini", "Azure"),
    );
    const aiChat = createAiChat(deps);
    const res = await aiChat("coach-notebook-extract", params);
    expect(res.model).toBe("openai/gpt-4o-mini");
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      {
        ...params,
        model: "openai/gpt-4o-mini",
        provider: { zdr: true, only: ["azure"] },
      },
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

  it("an override model with no pinned host throws before any request", async () => {
    const deps = makeDeps();
    const aiChat = createAiChat(deps);
    const c = ctx({
      overrides: {
        "coach-notebook-extract": { model: "anthropic/claude-sonnet-4.6" },
      },
    });
    await expect(
      withAiCallContext(c, () => aiChat("coach-notebook-extract", params)),
    ).rejects.toThrow(
      /no pinned OpenRouter host for "anthropic\/claude-sonnet-4.6"/,
    );
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
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

  it("fallback off + moderation 403 → records the failed call (moderated, request) and still rejects", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(403, "This model requires moderation: input was flagged"),
    );
    const aiChat = createAiChat(deps);
    const c = ctx();
    await expect(
      withAiCallContext(c, () => aiChat("coach-notebook-extract", params)),
    ).rejects.toThrow(/requires moderation/);
    expect(c.calls).toEqual([
      {
        feature: "coach-notebook-extract",
        requestedModel: AI_FEATURES["coach-notebook-extract"].model,
        answeredModel: null,
        answeredProvider: null,
        fellBack: false,
        error: {
          kind: "request",
          moderated: true,
          message: expect.stringContaining("requires moderation"),
        },
      },
    ]);
  });

  it("fallback off + 503 → records a non-moderated transport failure; message is capped", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503, "x".repeat(500)),
    );
    const aiChat = createAiChat(deps);
    const c = ctx();
    await expect(
      withAiCallContext(c, () => aiChat("coach-notebook-extract", params)),
    ).rejects.toThrow();
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].error?.kind).toBe("transport");
    expect(c.calls[0].error?.moderated).toBe(false);
    expect(c.calls[0].error?.message.length).toBeLessThanOrEqual(300);
  });

  it("fallback off + abort → no record", async () => {
    const deps = makeDeps();
    const ac = new AbortController();
    vi.mocked(deps.openrouter!.chat.completions.create).mockImplementation(
      async () => {
        ac.abort();
        throw new Error("aborted");
      },
    );
    const aiChat = createAiChat(deps);
    const c = ctx();
    await expect(
      withAiCallContext(c, () =>
        aiChat("coach-notebook-extract", params, { signal: ac.signal }),
      ),
    ).rejects.toThrow();
    expect(c.calls).toEqual([]);
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

const chunk = (
  content: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id: "s1",
  object: "chat.completion.chunk",
  created: 0,
  model: "openai/gpt-4o-mini",
  provider: "Azure",
  choices: [
    {
      index: 0,
      delta: content === null ? { role: "assistant" } : { content },
      finish_reason: null,
    },
  ],
  ...extra,
});

function fakeStream(items: (object | Error)[]) {
  const returned = { value: false };
  const iterable = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= items.length) return { done: true, value: undefined };
          const item = items[i++];
          if (item instanceof Error) throw item;
          return { done: false, value: item };
        },
        async return() {
          returned.value = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  return { iterable, returned };
}

async function collect(
  stream: AsyncIterable<{ choices: { delta: { content?: string | null } }[] }>,
) {
  let text = "";
  for await (const c of stream) text += c.choices[0]?.delta?.content ?? "";
  return text;
}

describe("aiChat (streaming)", () => {
  const sparams = { ...params, stream: true as const };

  it("replays the peeked first chunk and passes the rest through", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([chunk("Hel"), chunk("lo")]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("coach-chat", sparams))).toBe("Hello");
  });

  it("a role-only first chunk counts as received", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([
      chunk(null),
      chunk("x"),
      new Error("mid-stream"),
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    const stream = await aiChat("coach-chat", sparams);
    await expect(collect(stream)).rejects.toThrow("mid-stream");
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("a role-only first chunk alone commits to OpenRouter (error after it is not a fallback)", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([chunk(null), new Error("mid-stream")]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    const stream = await aiChat("coach-chat", sparams);
    await expect(collect(stream)).rejects.toThrow("mid-stream");
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("an HTTP error before any chunk falls back", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    const { iterable } = fakeStream([chunk("fallback")]);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("coach-chat", sparams))).toBe("fallback");
  });

  it("an in-stream error as the FIRST event falls back", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([
      {
        ...chunk(""),
        error: { code: "server_error" },
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      },
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const fb = fakeStream([chunk("ok")]);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      fb.iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("coach-chat", sparams))).toBe("ok");
  });

  it("the first next() throwing (SDK-raised SSE error) falls back", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([new Error("provider disconnected")]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const fb = fakeStream([chunk("ok")]);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      fb.iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("coach-chat", sparams))).toBe("ok");
  });

  it("an in-stream error AFTER the first chunk is thrown to the caller (no fallback)", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([
      chunk("a"),
      {
        ...chunk(""),
        error: { code: "server_error" },
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      },
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    await expect(collect(await aiChat("coach-chat", sparams))).rejects.toThrow(
      /in-stream error/,
    );
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("abort while peeking re-throws without fallback", async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    const { iterable } = fakeStream([new OpenAI.APIUserAbortError()]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockImplementation(
      async () => {
        controller.abort();
        return iterable;
      },
    );
    const aiChat = createAiChat(deps);
    await expect(
      aiChat("coach-chat", sparams, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OpenAI.APIUserAbortError);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("early consumer exit closes the source stream and logs completed:false", async () => {
    const deps = makeDeps();
    const { iterable, returned } = fakeStream([
      chunk("a"),
      chunk("b"),
      chunk("c"),
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    for await (const _c of await aiChat("coach-chat", sparams)) break;
    expect(returned.value).toBe(true);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "coach-chat", completed: false }),
      expect.any(String),
    );
  });

  it("logs usage cost from the last chunk and records the call at stream end", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([
      chunk("a"),
      {
        ...chunk(null),
        choices: [],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          cost: 0.002,
        },
      },
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    const c: AiCallContext = { overrides: {}, fallback: "off", calls: [] };
    await withAiCallContext(c, async () => {
      const stream = await aiChat("coach-chat", sparams);
      expect(c.calls).toHaveLength(0); // not yet — written at stream end
      await collect(stream);
    });
    expect(c.calls).toEqual([
      {
        feature: "coach-chat",
        requestedModel: "openai/gpt-6-luna", // the coach-chat row
        answeredModel: "openai/gpt-4o-mini", // what the fake chunks report
        answeredProvider: "Azure",
        fellBack: false,
      },
    ]);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "coach-chat",
        cost: 0.002,
        completed: true,
      }),
      expect.any(String),
    );
  });
});

describe("aiChat default deps", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("an empty OPENROUTER_API_KEY is treated as unset", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "  ");
    vi.resetModules();
    const mod = await import("../ai-client");
    const { openai } = await import("../openai");
    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini") as unknown as Awaited<
        ReturnType<typeof openai.chat.completions.create>
      >,
    );
    await mod.aiChat("coach-notebook-extract", params);
    expect(openai.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
      undefined,
    );
    // The fallback path above is also what a failed OpenRouter call lands on,
    // so discriminate with fallback off: no client => the "key required" error.
    const c: AiCallContext = { overrides: {}, fallback: "off", calls: [] };
    await expect(
      mod.withAiCallContext(c, () =>
        mod.aiChat("coach-notebook-extract", params),
      ),
    ).rejects.toThrow(/OPENROUTER_API_KEY is required when fallback is off/);
  });
});
