// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import OpenAI from "openai";
import {
  createAiChat,
  fillThoughtSignatures,
  withAiCallContext,
} from "../ai-client";
import type { AiChatDeps, AiChatParams } from "../ai-client";
import { CircuitBreaker, InStreamError, VertexAuthError } from "../ai-failure";
import type { AiCallContext } from "../ai-call-context";
import { AI_FEATURES, VERTEX_BACKUP_REASONING_HEADROOM } from "../ai-models";
import type { AiFeature } from "../ai-models";

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
  OPENAI_TIMEOUT_FAST_MS: 15_000,
  VERTEX_BACKUP_TIMEOUT_FAST_MS: 30_000,
}));
vi.mock("../ai-models", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ai-models")>();
  return {
    ...real,
    AI_FEATURES: {
      ...real.AI_FEATURES,
      // Synthetic Vertex-first row: no real row is flagged until rollout PR 2.
      "test-vertex-row": {
        model: "google/gemini-3.8-flash",
        json: true,
        vision: true,
        primary: "vertex",
        adapt: { set: { reasoning_effort: "low" } },
      },
      // Synthetic vertexBackup row, Luna-shaped so the row's own adapt
      // (drop temperature) visibly does NOT reach the backup body.
      "test-backup-row": {
        model: "openai/gpt-6-luna",
        json: false,
        vision: false,
        adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } },
        vertexBackup: real.VERTEX_BACKUP,
      },
    },
  };
});

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
    vertex: null,
    fallback: { chat: { completions: { create: vi.fn() } } },
    breaker: new CircuitBreaker(),
    vertexBreaker: new CircuitBreaker(),
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
    await aiChat("photo-classify", params, { timeout: 15_000 });
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
    const res = await aiChat("photo-classify", params);
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
      await aiChat("photo-classify", params);
      expect(deps.fallback.chat.completions.create).toHaveBeenCalledWith(
        { ...params, model: "gpt-4o-mini" },
        undefined,
      );
      expect(spy).toHaveBeenCalledTimes(counts ? 1 : 0);
      expect(deps.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: "photo-classify",
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
    await aiChat("photo-classify", params);
    expect(vi.mocked(deps.report).mock.calls.at(-1)![0].message).toMatch(
      /balance exhausted/i,
    );

    create.mockRejectedValueOnce(apiError(400, "unknown model"));
    await aiChat("photo-classify", params);
    expect(vi.mocked(deps.report).mock.calls.at(-1)![0].message).toMatch(
      /AI config error: photo-classify/,
    );

    vi.mocked(deps.report).mockClear();
    create.mockRejectedValueOnce(apiError(400, "content_filter triggered"));
    await aiChat("photo-classify", params);
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
      aiChat("photo-classify", params, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OpenAI.APIUserAbortError);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  // One row per isAbort arm: each row trips exactly one of them.
  it.each([
    ["APIUserAbortError, no signal", new OpenAI.APIUserAbortError(), false],
    [
      "aborted signal, APIConnectionError",
      new OpenAI.APIConnectionError({ message: "socket closed" }),
      true,
    ],
  ] as const)(
    "abort (%s) → re-thrown; no breaker, report or fallback",
    async (_label, err, abortSignal) => {
      const controller = new AbortController();
      if (abortSignal) controller.abort();
      vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
        err,
      );
      const spy = vi.spyOn(deps.breaker, "recordFailure");
      const aiChat = createAiChat(deps);
      await expect(
        aiChat("photo-classify", params, {
          signal: abortSignal ? controller.signal : undefined,
        }),
      ).rejects.toBe(err);
      expect(spy).not.toHaveBeenCalled();
      expect(deps.report).not.toHaveBeenCalled();
      expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
    },
  );

  it("the fallback warn log carries the original OpenRouter error", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503, "upstream unavailable"),
    );
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("photo-classify", params);
    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackReason: "transport",
        error: {
          status: 503,
          message: expect.stringContaining("upstream unavailable"),
        },
      }),
      expect.any(String),
    );
  });

  it("a non-string model in the response is recorded and logged as null", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue({
      ...completion("x"),
      model: undefined,
    });
    const aiChat = createAiChat(deps);
    const c: AiCallContext = { overrides: {}, fallback: "on", calls: [] };
    await withAiCallContext(c, () => aiChat("photo-classify", params));
    expect(c.calls[0].answeredModel).toBeNull();
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ answeredModel: null }),
      expect.any(String),
    );
  });

  it("a non-string model from the fallback is recorded as null", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue({
      ...completion("x"),
      model: 42,
    });
    const aiChat = createAiChat(deps);
    const c: AiCallContext = { overrides: {}, fallback: "on", calls: [] };
    await withAiCallContext(c, () => aiChat("photo-classify", params));
    expect(c.calls[0]).toMatchObject({ answeredModel: null, fellBack: true });
  });

  describe("config-error reports are throttled per feature", () => {
    let clock: number;
    beforeEach(() => {
      clock = 0;
      deps = makeDeps({ now: () => clock });
      vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
        apiError(400, "unknown model"),
      );
      vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
        completion("gpt-4o-mini"),
      );
    });

    it("same feature inside the window → one report; every failure still falls back and warns", async () => {
      const aiChat = createAiChat(deps);
      await aiChat("photo-classify", params);
      clock = 9 * 60_000;
      await aiChat("photo-classify", params);
      expect(deps.report).toHaveBeenCalledTimes(1);
      expect(deps.fallback.chat.completions.create).toHaveBeenCalledTimes(2);
      expect(deps.log.warn).toHaveBeenCalledTimes(2);
    });

    it("same feature after the window → reported again", async () => {
      const aiChat = createAiChat(deps);
      await aiChat("photo-classify", params);
      clock = 10 * 60_000;
      await aiChat("photo-classify", params);
      expect(deps.report).toHaveBeenCalledTimes(2);
    });

    it("a different feature inside the window → still reported", async () => {
      const aiChat = createAiChat(deps);
      await aiChat("photo-classify", params);
      await aiChat("receipt-scan", params);
      expect(deps.report).toHaveBeenCalledTimes(2);
    });

    it("the balance alert is not throttled", async () => {
      vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
        apiError(402),
      );
      const aiChat = createAiChat(deps);
      await aiChat("photo-classify", params);
      await aiChat("photo-classify", params);
      expect(deps.report).toHaveBeenCalledTimes(2);
    });
  });

  it("an open breaker skips OpenRouter entirely", async () => {
    for (let i = 0; i < 5; i++) deps.breaker.recordFailure();
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("photo-classify", params);
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
    await aiChat("photo-classify", params);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "photo-classify",
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
        "photo-classify": {
          model: "openai/gpt-6-luna",
          set: { reasoning_effort: "low" },
        },
      },
    });
    await withAiCallContext(c, () => aiChat("photo-classify", params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-6-luna",
        reasoning_effort: "low",
      }),
      undefined,
    );
    expect(c.calls).toEqual([
      {
        feature: "photo-classify",
        requestedModel: "openai/gpt-6-luna",
        answeredModel: "openai/gpt-6-luna",
        answeredProvider: "Azure",
        fellBack: false,
        finishReason: "stop",
        usage: expect.objectContaining({ prompt_tokens: 1 }),
      },
    ]);
  });

  it("an override model with no pinned host throws before any request", async () => {
    const deps = makeDeps();
    const aiChat = createAiChat(deps);
    const c = ctx({
      overrides: {
        "photo-classify": { model: "anthropic/claude-sonnet-4.6" },
      },
    });
    await expect(
      withAiCallContext(c, () => aiChat("photo-classify", params)),
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
      withAiCallContext(ctx(), () => aiChat("photo-classify", params)),
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
      withAiCallContext(c, () => aiChat("photo-classify", params)),
    ).rejects.toThrow(/requires moderation/);
    expect(c.calls).toEqual([
      {
        feature: "photo-classify",
        requestedModel: AI_FEATURES["photo-classify"].model,
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
      withAiCallContext(c, () => aiChat("photo-classify", params)),
    ).rejects.toThrow();
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].error?.kind).toBe("transport");
    expect(c.calls[0].error?.moderated).toBe(false);
    expect(c.calls[0].error?.message.length).toBeLessThanOrEqual(300);
  });

  it.each([
    [503, "upstream says: input was flagged"],
    [429, "requires moderation queue is full"],
  ])(
    "fallback off + %i mentioning moderation → transport, NOT moderated",
    async (status, message) => {
      const deps = makeDeps();
      vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
        apiError(status, message),
      );
      const aiChat = createAiChat(deps);
      const c = ctx();
      await expect(
        withAiCallContext(c, () => aiChat("photo-classify", params)),
      ).rejects.toThrow();
      expect(c.calls[0].error).toMatchObject({
        kind: "transport",
        moderated: false,
      });
    },
  );

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
        aiChat("photo-classify", params, { signal: ac.signal }),
      ),
    ).rejects.toThrow();
    expect(c.calls).toEqual([]);
  });

  it("fallback off with no key throws a clear error", async () => {
    const deps = makeDeps({ openrouter: null });
    const aiChat = createAiChat(deps);
    await expect(
      withAiCallContext(ctx(), () => aiChat("photo-classify", params)),
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
    await withAiCallContext(ctx(), () => aiChat("photo-classify", params));
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
      overrides: { "photo-classify": { model: "openai/gpt-6-luna" } },
    });
    await withAiCallContext(c, () => aiChat("photo-classify", params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-6-luna" }),
      undefined,
    );
    vi.unstubAllEnvs();
  });

  it("no context → row model used", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("photo-classify", params);
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

function fakeStream(
  items: (object | Error)[],
  opts: { returnRejects?: boolean } = {},
) {
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
          if (opts.returnRejects) throw new Error("return() failed");
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
    expect(await collect(await aiChat("photo-classify", sparams))).toBe(
      "Hello",
    );
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
    const stream = await aiChat("photo-classify", sparams);
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
    const stream = await aiChat("photo-classify", sparams);
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
    expect(await collect(await aiChat("photo-classify", sparams))).toBe(
      "fallback",
    );
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
    expect(await collect(await aiChat("photo-classify", sparams))).toBe("ok");
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
    expect(await collect(await aiChat("photo-classify", sparams))).toBe("ok");
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
    await expect(
      collect(await aiChat("photo-classify", sparams)),
    ).rejects.toThrow(/in-stream error/);
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
      aiChat("photo-classify", sparams, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OpenAI.APIUserAbortError);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  // One row per isAbort arm, as in the non-streaming block.
  it.each([
    ["APIUserAbortError, no signal", new OpenAI.APIUserAbortError(), false],
    [
      "aborted signal, APIConnectionError",
      new OpenAI.APIConnectionError({ message: "socket closed" }),
      true,
    ],
  ] as const)(
    "abort while peeking (%s) → re-thrown; no breaker, report or fallback",
    async (_label, err, abortSignal) => {
      const deps = makeDeps();
      const controller = new AbortController();
      const { iterable } = fakeStream([err]);
      vi.mocked(deps.openrouter!.chat.completions.create).mockImplementation(
        async () => {
          if (abortSignal) controller.abort();
          return iterable;
        },
      );
      const spy = vi.spyOn(deps.breaker, "recordFailure");
      const aiChat = createAiChat(deps);
      await expect(
        aiChat("photo-classify", sparams, {
          signal: abortSignal ? controller.signal : undefined,
        }),
      ).rejects.toBe(err);
      expect(spy).not.toHaveBeenCalled();
      expect(deps.report).not.toHaveBeenCalled();
      expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
    },
  );

  it("an empty stream counts as success and yields nothing", async () => {
    const deps = makeDeps();
    for (let i = 0; i < 3; i++) deps.breaker.recordFailure();
    const recordSuccess = vi.spyOn(deps.breaker, "recordSuccess");
    const { iterable } = fakeStream([]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("photo-classify", sparams))).toBe("");
    expect(recordSuccess).toHaveBeenCalledTimes(1);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "photo-classify",
        completed: true,
      }),
      expect.any(String),
    );
  });

  it("a rejecting return() does not mask a mid-stream error, and the stream is still logged", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([chunk("a"), new Error("mid-stream")], {
      returnRejects: true,
    });
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    await expect(
      collect(await aiChat("photo-classify", sparams)),
    ).rejects.toThrow("mid-stream");
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "photo-classify",
        completed: false,
      }),
      expect.any(String),
    );
  });

  it("a rejecting return() on early consumer exit does not throw into the consumer", async () => {
    const deps = makeDeps();
    const { iterable, returned } = fakeStream([chunk("a"), chunk("b")], {
      returnRejects: true,
    });
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    for await (const _c of await aiChat("photo-classify", sparams)) break;
    expect(returned.value).toBe(true);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "photo-classify",
        completed: false,
      }),
      expect.any(String),
    );
  });

  it("a rejecting return() while peeking does not mask the in-stream error", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream(
      [
        {
          ...chunk(""),
          error: { code: "server_error" },
          choices: [
            { index: 0, delta: { content: "" }, finish_reason: "error" },
          ],
        },
      ],
      { returnRejects: true },
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const fb = fakeStream([chunk("ok")]);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      fb.iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("photo-classify", sparams))).toBe("ok");
    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: "OpenRouter in-stream error",
        }),
      }),
      expect.any(String),
    );
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
    for await (const _c of await aiChat("photo-classify", sparams)) break;
    expect(returned.value).toBe(true);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "photo-classify",
        completed: false,
      }),
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
      const stream = await aiChat("photo-classify", sparams);
      expect(c.calls).toHaveLength(0); // not yet — written at stream end
      await collect(stream);
    });
    expect(c.calls).toEqual([
      {
        feature: "photo-classify",
        requestedModel: "openai/gpt-4o-mini", // the photo-classify row
        answeredModel: "openai/gpt-4o-mini", // what the fake chunks report
        answeredProvider: "Azure",
        fellBack: false,
        finishReason: null,
        usage: expect.objectContaining({ completion_tokens: 1 }),
      },
    ]);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "photo-classify",
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
    await mod.aiChat("photo-classify", params);
    expect(openai.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
      undefined,
    );
    // The fallback path above is also what a failed OpenRouter call lands on,
    // so discriminate with fallback off: no client => the "key required" error.
    const c: AiCallContext = { overrides: {}, fallback: "off", calls: [] };
    await expect(
      mod.withAiCallContext(c, () => mod.aiChat("photo-classify", params)),
    ).rejects.toThrow(/OPENROUTER_API_KEY is required when fallback is off/);
  });
});

describe("aiChat (Vertex-first rows)", () => {
  // Synthetic row from the ai-models mock above; not in the AiFeature union.
  const V = "test-vertex-row" as unknown as AiFeature;
  const client = () => ({ chat: { completions: { create: vi.fn() } } });
  const ctxOn = (): AiCallContext => ({
    overrides: {},
    fallback: "on",
    calls: [],
  });
  const ctxOff = (): AiCallContext => ({
    overrides: {},
    fallback: "off",
    calls: [],
  });
  let deps: AiChatDeps;
  beforeEach(() => {
    deps = makeDeps({ vertex: client() });
  });
  const neverOpenAI = () =>
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();

  it("Vertex answers: adapted params, no provider key, recorded as vertex", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash"),
    );
    const ctx = ctxOn();
    await withAiCallContext(ctx, () =>
      createAiChat(deps)(V, params, { timeout: 9 }),
    );
    const [body, opts] = vi.mocked(deps.vertex!.chat.completions.create).mock
      .calls[0];
    expect(body).toEqual({
      ...params,
      model: "google/gemini-3.8-flash",
      reasoning_effort: "low",
    });
    expect(body).not.toHaveProperty("provider");
    expect(opts).toEqual({ timeout: 9 });
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(ctx.calls[0]).toMatchObject({
      answeredProvider: "vertex",
      fellBack: false,
    });
    neverOpenAI();
  });

  it("Vertex fails (5xx) → OpenRouter with zdr + pinned host + adapt; fellBack", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const ctx = ctxOn();
    await withAiCallContext(ctx, () => createAiChat(deps)(V, params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      {
        ...params,
        model: "google/gemini-3.8-flash",
        reasoning_effort: "low",
        provider: { zdr: true, only: ["google-vertex"] },
      },
      undefined,
    );
    expect(ctx.calls[0]).toMatchObject({ fellBack: true });
    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        fallbackReason: "transport",
      }),
      "ai call using fallback",
    );
    neverOpenAI();
  });

  it("both routes fail → throws the last error, reports, never OpenAI", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(502, "or down"),
    );
    await expect(createAiChat(deps)(V, params)).rejects.toThrow("or down");
    expect(deps.report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("test-vertex-row"),
      }),
      "ai-client",
    );
    neverOpenAI();
  });

  it("vertex only: Vertex present, OpenRouter absent → Vertex answers, no warn", async () => {
    deps = makeDeps({ vertex: client(), openrouter: null });
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash"),
    );
    await createAiChat(deps)(V, params);
    expect(deps.vertex!.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(deps.log.warn).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("vertex null → OpenRouter directly, not marked fellBack", async () => {
    deps = makeDeps({ vertex: null });
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const ctx = ctxOn();
    await withAiCallContext(ctx, () => createAiChat(deps)(V, params));
    expect(ctx.calls[0]).toMatchObject({ fellBack: false });
    neverOpenAI();
  });

  it("no route available: both clients null → config error naming both env vars", async () => {
    deps = makeDeps({ vertex: null, openrouter: null });
    await expect(createAiChat(deps)(V, params)).rejects.toThrow(
      /GOOGLE_VERTEX_.*OPENROUTER_API_KEY/,
    );
    neverOpenAI();
  });

  it("no route available: Vertex breaker open and OpenRouter absent → error, not OpenAI", async () => {
    deps = makeDeps({ vertex: client(), openrouter: null });
    for (let i = 0; i < 5; i++) deps.vertexBreaker.recordFailure();
    await expect(createAiChat(deps)(V, params)).rejects.toThrow(
      /vertex: circuit open/,
    );
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("Vertex breaker open → straight to OpenRouter", async () => {
    for (let i = 0; i < 5; i++) deps.vertexBreaker.recordFailure();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    await createAiChat(deps)(V, params);
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
  });

  it("breakers are separate: Vertex failures never open the OpenRouter breaker", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const aiChat = createAiChat(deps);
    for (let i = 0; i < 6; i++) await aiChat(V, params);
    expect(deps.vertexBreaker.isOpen()).toBe(true);
    expect(deps.breaker.isOpen()).toBe(false);
  });

  it("breakers are separate: OpenRouter failures never open the Vertex breaker", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    for (let i = 0; i < 6; i++) await aiChat("photo-classify", params);
    expect(deps.breaker.isOpen()).toBe(true);
    expect(deps.vertexBreaker.isOpen()).toBe(false);
  });

  it("abort on Vertex is rethrown without trying OpenRouter", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      new OpenAI.APIUserAbortError(),
    );
    await expect(
      createAiChat(deps)(V, params, { signal: ac.signal }),
    ).rejects.toThrow();
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("auth failure: VertexAuthError → config report (throttled), then OpenRouter", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      new VertexAuthError(
        "Vertex login failed — check GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL / _KEY",
      ),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const aiChat = createAiChat(deps);
    await aiChat(V, params);
    await aiChat(V, params);
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.report).mock.calls[0][0].message).toMatch(
      /AI config error: test-vertex-row \(vertex\)/,
    );
    expect(deps.vertexBreaker.isOpen()).toBe(false);
  });

  it("402 text: OpenRouter balance on a Vertex-first row does not mention OpenAI", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(402),
    );
    await expect(createAiChat(deps)(V, params)).rejects.toThrow();
    const messages = vi.mocked(deps.report).mock.calls.map(([e]) => e.message);
    expect(messages.some((m) => /402/.test(m))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/OpenAI/);
  });

  it("eval context (fallback off): Vertex failure is recorded and thrown, OpenRouter untried", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(400, "bad field"),
    );
    const ctx = ctxOff();
    await expect(
      withAiCallContext(ctx, () => createAiChat(deps)(V, params)),
    ).rejects.toThrow("bad field");
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(ctx.calls[0]).toMatchObject({ error: { kind: "config" } });
  });

  it("eval context (fallback off) with no Vertex client measures OpenRouter", async () => {
    deps = makeDeps({ vertex: null });
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    await withAiCallContext(ctxOff(), () => createAiChat(deps)(V, params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("eval override model/set reaches the Vertex body", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-4-argon"),
    );
    const ctx: AiCallContext = {
      overrides: {
        "test-vertex-row": {
          model: "google/gemini-4-argon",
          set: { reasoning_effort: "medium" },
        },
      } as unknown as AiCallContext["overrides"],
      fallback: "off",
      calls: [],
    };
    await withAiCallContext(ctx, () => createAiChat(deps)(V, params));
    expect(
      vi.mocked(deps.vertex!.chat.completions.create).mock.calls[0][0],
    ).toMatchObject({
      model: "google/gemini-4-argon",
      reasoning_effort: "medium",
    });
  });

  it("stream: true on a Vertex-first row throws before any call", async () => {
    await expect(
      createAiChat(deps)(V, { ...params, stream: true }),
    ).rejects.toThrow(/stream/);
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });
});

describe("aiChat (vertexBackup rows)", () => {
  // Synthetic row from the ai-models mock above; not in the AiFeature union.
  const B = "test-backup-row" as unknown as AiFeature;
  const FLASH = "google/gemini-3.8-flash";
  const client = () => ({ chat: { completions: { create: vi.fn() } } });
  const ctxWith = (over: Partial<AiCallContext> = {}): AiCallContext => ({
    overrides: {},
    fallback: "on",
    calls: [],
    ...over,
  });
  let deps: AiChatDeps;
  beforeEach(() => {
    deps = makeDeps({ vertex: client() });
  });
  const neverOpenAI = () =>
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  const reportMessages = () =>
    vi.mocked(deps.report).mock.calls.map(([e]) => e.message);

  it("OpenRouter succeeds → Vertex never called", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-6-luna", "Azure"),
    );
    await createAiChat(deps)(B, params);
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it.each([
    ["transport", apiError(500)],
    ["balance", apiError(402)],
    ["config", apiError(400, "invalid model")],
    ["request", apiError(400, "maximum context length exceeded")],
  ] as const)(
    "OpenRouter fails (%s) → Vertex backup: Flash, backup adapt only, no provider, same options",
    async (_kind, err) => {
      vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
        err,
      );
      vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
        completion(FLASH),
      );
      const ctx = ctxWith();
      const options = { timeout: 9 };
      const res = await withAiCallContext(ctx, () =>
        createAiChat(deps)(B, params, options),
      );
      expect(res.model).toBe(FLASH);
      const [body, opts] = vi.mocked(deps.vertex!.chat.completions.create).mock
        .calls[0];
      // temperature KEPT: the row's Luna adapt is not applied to the backup.
      // The cap gains thinking room (owner 2026-11-03).
      expect(body).toEqual({
        ...params,
        max_completion_tokens: 50 + VERTEX_BACKUP_REASONING_HEADROOM,
        model: FLASH,
        reasoning_effort: "low",
      });
      expect(body).not.toHaveProperty("provider");
      expect(opts).toBe(options);
      expect(ctx.calls.at(-1)).toMatchObject({
        answeredProvider: "vertex",
        fellBack: true,
      });
      neverOpenAI();
    },
  );

  // Owner 2026-11-03: a short caller deadline (finder-classify-turn 6 s) timed
  // Vertex out in the PR 3 gate; the backup leg may be given longer.
  it("backupTimeout replaces the timeout on the Vertex leg only, and no SDK call sees it", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    await createAiChat(deps)(B, params, { timeout: 6, backupTimeout: 12 });
    expect(
      vi.mocked(deps.openrouter!.chat.completions.create).mock.calls[0][1],
    ).toEqual({ timeout: 6 });
    expect(
      vi.mocked(deps.vertex!.chat.completions.create).mock.calls[0][1],
    ).toEqual({ timeout: 12 });
  });

  // Owner 2026-11-03: Gemini 3.8 Flash cannot switch thinking off, and once
  // spent 189 of a 200-token cap on it in the PR 3 gate.
  it("a max_tokens cap also gains thinking room; a call with no cap gets none", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    const { max_completion_tokens: _cap, ...uncapped } = params;
    await createAiChat(deps)(B, { ...uncapped, max_tokens: 20 });
    await createAiChat(deps)(B, uncapped);
    const [[withCap], [noCap]] = vi.mocked(deps.vertex!.chat.completions.create)
      .mock.calls;
    expect(withCap.max_tokens).toBe(20 + VERTEX_BACKUP_REASONING_HEADROOM);
    expect(noCap).not.toHaveProperty("max_tokens");
    expect(noCap).not.toHaveProperty("max_completion_tokens");
    expect(
      vi.mocked(deps.openrouter!.chat.completions.create).mock.calls[0][0]
        .max_tokens,
    ).toBe(20);
  });

  // Owner 2026-11-03: every 15 s "fast" caller gets 30 s on the backup leg.
  it("a 15 s fast-limit call gets 30 s on the Vertex leg; OpenRouter keeps 15 s", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    await createAiChat(deps)(B, params, { timeout: 15_000 });
    expect(
      vi.mocked(deps.openrouter!.chat.completions.create).mock.calls[0][1],
    ).toEqual({ timeout: 15_000 });
    expect(
      vi.mocked(deps.vertex!.chat.completions.create).mock.calls[0][1],
    ).toEqual({ timeout: 30_000 });
  });

  it("json response_format and image parts reach the Vertex body unchanged", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    const visionParams = {
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "what is this" },
            {
              type: "image_url" as const,
              image_url: {
                url: "data:image/jpeg;base64,AAAA",
                detail: "low" as const,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" as const },
    };
    await createAiChat(deps)(B, visionParams);
    const [body] = vi.mocked(deps.vertex!.chat.completions.create).mock
      .calls[0];
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual(visionParams.messages);
  });

  it("OpenRouter breaker open → straight to Vertex", async () => {
    for (let i = 0; i < 5; i++) deps.breaker.recordFailure();
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    await createAiChat(deps)(B, params);
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.vertex!.chat.completions.create).toHaveBeenCalledTimes(1);
    neverOpenAI();
  });

  it("Vertex not configured → rethrows the OpenRouter error, reports unavailable", async () => {
    deps = makeDeps({ vertex: null });
    const err = apiError(503);
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(err);
    await expect(createAiChat(deps)(B, params)).rejects.toBe(err);
    expect(reportMessages().some((m) => m.includes("unavailable"))).toBe(true);
    neverOpenAI();
  });

  it("both breakers open → throws 'both routes unavailable', never OpenAI", async () => {
    for (let i = 0; i < 5; i++) deps.breaker.recordFailure();
    for (let i = 0; i < 5; i++) deps.vertexBreaker.recordFailure();
    await expect(createAiChat(deps)(B, params)).rejects.toThrow(
      /both.*unavailable/,
    );
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("both fail → throws the Vertex error; a 500 counts on vertexBreaker", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    const vErr = apiError(500, "vertex down");
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(vErr);
    const spy = vi.spyOn(deps.vertexBreaker, "recordFailure");
    await expect(createAiChat(deps)(B, params)).rejects.toBe(vErr);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(reportMessages().some((m) => m.includes("unavailable"))).toBe(true);
    neverOpenAI();
  });

  it("OpenRouter abort → rethrown, Vertex not called", async () => {
    const abort = new OpenAI.APIUserAbortError();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      abort,
    );
    await expect(createAiChat(deps)(B, params)).rejects.toBe(abort);
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("abort during the Vertex backup → rethrown, not counted, no unavailable report", async () => {
    const ac = new AbortController();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    const abortErr = new Error("aborted");
    vi.mocked(deps.vertex!.chat.completions.create).mockImplementation(
      async () => {
        ac.abort();
        throw abortErr;
      },
    );
    const spy = vi.spyOn(deps.vertexBreaker, "recordFailure");
    await expect(
      createAiChat(deps)(B, params, { signal: ac.signal }),
    ).rejects.toBe(abortErr);
    expect(spy).not.toHaveBeenCalled();
    expect(reportMessages().some((m) => m.includes("unavailable"))).toBe(false);
    neverOpenAI();
  });

  it("no OpenRouter key → Vertex backup, never OpenAI", async () => {
    deps = makeDeps({ openrouter: null, vertex: client() });
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    const res = await createAiChat(deps)(B, params);
    expect(res.model).toBe(FLASH);
    neverOpenAI();
  });

  it("no OpenRouter key and no Vertex → config error naming both", async () => {
    deps = makeDeps({ openrouter: null, vertex: null });
    await expect(createAiChat(deps)(B, params)).rejects.toThrow(
      /OPENROUTER_API_KEY.*GOOGLE_VERTEX_/,
    );
    neverOpenAI();
  });

  it("eval context with fallback off → OpenRouter only; failure recorded, Vertex never tried", async () => {
    const err = apiError(503);
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(err);
    const ctx = ctxWith({ fallback: "off" });
    await expect(
      withAiCallContext(ctx, () => createAiChat(deps)(B, params)),
    ).rejects.toBe(err);
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    expect(ctx.calls.at(-1)?.error?.kind).toBe("transport");
    neverOpenAI();
  });

  it("forceBackup: true → OpenRouter skipped, Vertex answers (even with fallback off)", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    const ctx = ctxWith({ fallback: "off", forceBackup: true });
    await withAiCallContext(ctx, () => createAiChat(deps)(B, params));
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(ctx.calls.at(-1)).toMatchObject({
      answeredProvider: "vertex",
      fellBack: true,
    });
    neverOpenAI();
  });

  it("forceBackup as a function of the call index", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-6-luna", "Azure"),
    );
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    const ctx = ctxWith({ forceBackup: (i) => i === 1 });
    const aiChat = createAiChat(deps);
    await withAiCallContext(ctx, async () => {
      await aiChat(B, params);
      await aiChat(B, params);
    });
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(deps.vertex!.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(ctx.calls.map((c) => c.answeredProvider)).toEqual([
      "Azure",
      "vertex",
    ]);
  });

  it("forceBackup on a row with no vertexBackup throws", async () => {
    const ctx = ctxWith({ forceBackup: true });
    await expect(
      withAiCallContext(ctx, () =>
        createAiChat(deps)("photo-classify", params),
      ),
    ).rejects.toThrow(/forceBackup on a row with no vertexBackup/);
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
  });

  it("forceBackup on a Vertex-first row throws instead of being ignored", async () => {
    const ctx = ctxWith({ forceBackup: true });
    const V = "test-vertex-row" as unknown as AiFeature;
    await expect(
      withAiCallContext(ctx, () => createAiChat(deps)(V, params)),
    ).rejects.toThrow(/forceBackup on a row with no vertexBackup/);
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
  });

  it("no OpenRouter key and Vertex breaker open → report says OpenRouter was not tried", async () => {
    deps = makeDeps({ openrouter: null, vertex: client() });
    for (let i = 0; i < 5; i++) deps.vertexBreaker.recordFailure();
    await expect(createAiChat(deps)(B, params)).rejects.toThrow(/unavailable/);
    const msg = reportMessages().find((m) => m.includes("unavailable"));
    expect(msg).toBeDefined();
    expect(msg).not.toContain("OpenRouter failed");
    expect(msg).toContain("config");
  });

  it("402 report names the Vertex backup, not OpenAI", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(402),
    );
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    await createAiChat(deps)(B, params);
    const balance = reportMessages().find((m) => m.includes("402"));
    expect(balance).toContain("Vertex backup");
    expect(balance).not.toContain("OpenAI");
  });

  it("warn log carries provider vertex, backupModel and fallbackReason", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion(FLASH),
    );
    await createAiChat(deps)(B, params);
    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "vertex",
        backupModel: FLASH,
        fallbackReason: "transport",
      }),
      "ai call using fallback",
    );
  });
});

describe("aiChat (vertexBackup rows, streaming)", () => {
  const B = "test-backup-row" as unknown as AiFeature;
  const FLASH = "google/gemini-3.8-flash";
  const sparams = { ...params, stream: true as const };
  const client = () => ({ chat: { completions: { create: vi.fn() } } });
  const errChunk = () => ({
    ...chunk(""),
    error: { code: "server_error" },
    choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
  });
  const vchunk = (content: string) => ({
    ...chunk(content),
    model: FLASH,
    provider: undefined,
  });
  let deps: AiChatDeps;
  beforeEach(() => {
    deps = makeDeps({ vertex: client() });
  });
  const neverOpenAI = () =>
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  const vertexStream = (items: (object | Error)[]) =>
    vi
      .mocked(deps.vertex!.chat.completions.create)
      .mockResolvedValue(fakeStream(items).iterable);

  it("OpenRouter create rejects → the Vertex stream, recorded as vertex", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vertexStream([vchunk("Hel"), vchunk("lo")]);
    const ctx: AiCallContext = { overrides: {}, fallback: "on", calls: [] };
    const text = await withAiCallContext(ctx, async () =>
      collect(await createAiChat(deps)(B, sparams)),
    );
    expect(text).toBe("Hello");
    const [body] = vi.mocked(deps.vertex!.chat.completions.create).mock
      .calls[0];
    expect(body).toMatchObject({ stream: true, model: FLASH });
    expect(ctx.calls.at(-1)).toMatchObject({
      answeredProvider: "vertex",
      fellBack: true,
    });
    neverOpenAI();
  });

  it("OpenRouter's first event is an error chunk → the Vertex stream", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      fakeStream([errChunk()]).iterable,
    );
    vertexStream([vchunk("ok")]);
    expect(await collect(await createAiChat(deps)(B, sparams))).toBe("ok");
    neverOpenAI();
  });

  it("OpenRouter fails after its first chunk → caller gets the error, no switch", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      fakeStream([chunk("a"), new Error("mid-stream")]).iterable,
    );
    const stream = await createAiChat(deps)(B, sparams);
    await expect(collect(stream)).rejects.toThrow("mid-stream");
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it.each([
    ["an error chunk", errChunk()],
    ["a thrown SDK error", apiError(500, "vertex sse error")],
  ])(
    "the Vertex stream's first event is %s → the call rejects, vertexBreaker counted",
    async (_label, first) => {
      vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
        apiError(503),
      );
      vertexStream([first]);
      const spy = vi.spyOn(deps.vertexBreaker, "recordFailure");
      await expect(createAiChat(deps)(B, sparams)).rejects.toBeDefined();
      expect(spy).toHaveBeenCalledTimes(1);
      neverOpenAI();
    },
  );

  it("the Vertex stream fails mid-way → the caller gets the error", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vertexStream([vchunk("a"), errChunk()]);
    const stream = await createAiChat(deps)(B, sparams);
    await expect(collect(stream)).rejects.toBeInstanceOf(InStreamError);
    neverOpenAI();
  });

  it("OpenRouter breaker open → the Vertex stream directly", async () => {
    for (let i = 0; i < 5; i++) deps.breaker.recordFailure();
    vertexStream([vchunk("ok")]);
    expect(await collect(await createAiChat(deps)(B, sparams))).toBe("ok");
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("forceBackup with stream: true → the Vertex stream", async () => {
    vertexStream([vchunk("ok")]);
    const ctx: AiCallContext = {
      overrides: {},
      fallback: "off",
      calls: [],
      forceBackup: true,
    };
    const text = await withAiCallContext(ctx, async () =>
      collect(await createAiChat(deps)(B, sparams)),
    );
    expect(text).toBe("ok");
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
  });
});

describe("Gemini thought signature fill", () => {
  const PLACEHOLDER = "skip_thought_signature_validator";
  const call = (id: string, sig?: string) => ({
    id,
    type: "function" as const,
    function: { name: "lookup", arguments: "{}" },
    ...(sig !== undefined && {
      extra_content: { google: { thought_signature: sig } },
    }),
  });
  const toolHistory = () => [
    { role: "user" as const, content: "what did I eat?" },
    {
      role: "assistant" as const,
      content: null,
      tool_calls: [call("a", "real-sig"), call("b")],
    },
    { role: "tool" as const, tool_call_id: "a", content: "x" },
    { role: "tool" as const, tool_call_id: "b", content: "y" },
  ];
  const sigsOf = (messages: unknown) =>
    (messages as { tool_calls?: ReturnType<typeof call>[] }[])
      .flatMap((m) => m.tool_calls ?? [])
      .map((c) => c.extra_content?.google.thought_signature);

  it("keeps a real signature and fills only the missing one", () => {
    expect(sigsOf(fillThoughtSignatures(toolHistory()))).toEqual([
      "real-sig",
      PLACEHOLDER,
    ]);
  });

  it("does not mutate its input; messages without tool_calls pass through deep-equal", () => {
    const input = toolHistory();
    const snapshot = structuredClone(input);
    const out = fillThoughtSignatures(input) as unknown[];
    expect(input).toEqual(snapshot);
    expect(out[0]).toEqual(input[0]);
    expect(out[2]).toEqual(input[2]);
    const plain = [{ role: "user", content: "hi" }];
    expect(fillThoughtSignatures(plain)).toEqual(plain);
  });

  it("vertexBackup row: the Vertex body gets the placeholder, the OpenRouter body has no extra_content", async () => {
    const deps = makeDeps({
      vertex: { chat: { completions: { create: vi.fn() } } },
    });
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash"),
    );
    const B = "test-backup-row" as unknown as AiFeature;
    const history = toolHistory().map((m) =>
      m.role === "assistant" ? { ...m, tool_calls: [call("a"), call("b")] } : m,
    );
    await createAiChat(deps)(B, {
      messages: history as AiChatParams["messages"],
    });
    const [orBody] = vi.mocked(deps.openrouter!.chat.completions.create).mock
      .calls[0];
    expect(JSON.stringify(orBody)).not.toContain("extra_content");
    const [vBody] = vi.mocked(deps.vertex!.chat.completions.create).mock
      .calls[0];
    expect(sigsOf(vBody.messages)).toEqual([PLACEHOLDER, PLACEHOLDER]);
  });

  it("Vertex-first row: the Vertex body gets the placeholder", async () => {
    const deps = makeDeps({
      vertex: { chat: { completions: { create: vi.fn() } } },
    });
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash"),
    );
    const V = "test-vertex-row" as unknown as AiFeature;
    await createAiChat(deps)(V, {
      messages: toolHistory() as AiChatParams["messages"],
    });
    const [vBody] = vi.mocked(deps.vertex!.chat.completions.create).mock
      .calls[0];
    expect(sigsOf(vBody.messages)).toEqual(["real-sig", PLACEHOLDER]);
  });
});

describe("default OpenRouter client construction", () => {
  afterEach(() => {
    vi.doUnmock("openai");
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("disables SDK retries (the fallback provider is the retry)", async () => {
    const ctorOpts: Record<string, unknown>[] = [];
    vi.resetModules();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.doMock("openai", async (importOriginal) => {
      const actual = await importOriginal<typeof import("openai")>();
      class Spy extends actual.default {
        constructor(opts: ConstructorParameters<typeof actual.default>[0]) {
          super(opts);
          ctorOpts.push(opts as Record<string, unknown>);
        }
      }
      return { ...actual, default: Spy };
    });
    await import("../ai-client");
    const openrouter = ctorOpts.find(
      (o) => o.baseURL === "https://openrouter.ai/api/v1",
    );
    expect(openrouter).toMatchObject({ maxRetries: 0 });
  });
});

describe("call records carry finish_reason and usage", () => {
  const B = "test-backup-row" as unknown as AiFeature;
  const FLASH = "google/gemini-3.8-flash";
  const ctx = (over: Partial<AiCallContext> = {}): AiCallContext => ({
    overrides: {},
    fallback: "on",
    calls: [],
    ...over,
  });
  const finishing = (c: ReturnType<typeof chunk>, finish: string | null) => ({
    ...c,
    choices: [{ ...c.choices[0], finish_reason: finish }],
  });

  it("a non-stream record carries finish_reason and usage", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini", "Azure"),
    );
    const c = ctx();
    await withAiCallContext(c, () =>
      createAiChat(deps)("photo-classify", params),
    );
    expect(c.calls[0]).toMatchObject({
      finishReason: "stop",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
  });

  it("a Vertex-backup non-stream record carries finish_reason and usage", async () => {
    const deps = makeDeps({
      vertex: { chat: { completions: { create: vi.fn() } } },
    });
    const res = completion(FLASH);
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue({
      ...res,
      choices: [{ ...res.choices[0], finish_reason: "length" }],
    });
    const c = ctx({ forceBackup: true });
    await withAiCallContext(c, () => createAiChat(deps)(B, params));
    expect(c.calls[0]).toMatchObject({
      answeredProvider: "vertex",
      finishReason: "length",
      usage: { completion_tokens: 1 },
    });
  });

  it("a stream record carries the last finish_reason and usage", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      fakeStream([
        chunk("a"),
        finishing(chunk("b"), "stop"),
        { ...chunk(""), choices: [], usage: { completion_tokens: 2 } },
      ]).iterable,
    );
    const c = ctx();
    await withAiCallContext(c, async () =>
      collect(
        await createAiChat(deps)("photo-classify", {
          ...params,
          stream: true as const,
        }),
      ),
    );
    expect(c.calls[0]).toMatchObject({
      finishReason: "stop",
      usage: { completion_tokens: 2 },
    });
  });

  it("a stream with no finish_reason records null", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      fakeStream([chunk("a"), chunk("b")]).iterable,
    );
    const c = ctx();
    await withAiCallContext(c, async () =>
      collect(
        await createAiChat(deps)("photo-classify", {
          ...params,
          stream: true as const,
        }),
      ),
    );
    expect(c.calls[0].finishReason).toBeNull();
  });
});
