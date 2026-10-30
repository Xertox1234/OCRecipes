/**
 * The single entry point for chat/vision completions (spec §3.2). Rows with
 * `primary: "vertex"` route Vertex AI direct → OpenRouter and never reach
 * OpenAI (spec 2026-10-19-vision-rows-vertex-direct). Every other row routes
 * via OpenRouter (zero-data-retention) when OPENROUTER_API_KEY is set, else
 * via today's OpenAI client; falls back per spec §3.4. Never call
 * `chat.completions.create` elsewhere — ocrecipes/no-direct-chat-completions.
 */
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { AI_FEATURES, adaptParams, hostForModel } from "./ai-models";
import type { AiFeature, AiFeatureConfig } from "./ai-models";
import { getAiCallContext, withAiCallContext } from "./ai-call-context";
import type { AiCallContext } from "./ai-call-context";
import {
  AI_ROUTE_MAX_RETRIES,
  AI_ROUTE_TIMEOUT_MS,
  CircuitBreaker,
  classifyAiFailure,
  countsTowardBreaker,
  InStreamError,
  isModerationBlock,
} from "./ai-failure";
import type { AiFailureKind } from "./ai-failure";
import { openai } from "./openai";
import { createVertexClient } from "./vertex-client";
import { createServiceLogger } from "./logger";
import { reportError } from "./error-reporter";

export { withAiCallContext };

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type AiChatParams = Omit<
  ChatCompletionCreateParamsNonStreaming,
  "model"
>;
export type AiChatStreamParams = Omit<
  ChatCompletionCreateParamsStreaming,
  "model"
>;
export interface AiChatOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface AiChatClient {
  chat: {
    completions: {
      create(
        body: Record<string, unknown>,
        options?: AiChatOptions,
      ): Promise<unknown>;
    };
  };
}

export interface AiChatDeps {
  openrouter: AiChatClient | null;
  /** Vertex AI direct — primary for `primary: "vertex"` rows; null = not configured. */
  vertex: AiChatClient | null;
  fallback: AiChatClient;
  breaker: CircuitBreaker;
  /** Separate from `breaker` (= OpenRouter health): one route's outage never trips the other. */
  vertexBreaker: CircuitBreaker;
  report: (error: Error, context: string) => void;
  log: {
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
  };
  now?: () => number;
}

export interface AiChat {
  (
    feature: AiFeature,
    params: AiChatStreamParams,
    options?: AiChatOptions,
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
  (
    feature: AiFeature,
    params: AiChatParams,
    options?: AiChatOptions,
  ): Promise<ChatCompletion>;
}

type FallbackReason = AiFailureKind | "circuit-open";

/** A misconfigured row fails every request; report it once per window. */
const CONFIG_REPORT_INTERVAL_MS = 10 * 60_000;

function answeredModel(res: unknown): string | null {
  const m = (res as { model?: unknown }).model;
  return typeof m === "string" ? m : null;
}
/** OpenRouter adds `provider` and `usage.cost` to the OpenAI response shape. */
function answeredProvider(res: unknown): string | null {
  const p = (res as { provider?: unknown }).provider;
  return typeof p === "string" ? p : null;
}
function usageCost(res: unknown): number | undefined {
  const c = (res as { usage?: { cost?: unknown } }).usage?.cost;
  return typeof c === "number" ? c : undefined;
}

function isAbort(err: unknown, options?: AiChatOptions): boolean {
  return (
    options?.signal?.aborted === true || err instanceof OpenAI.APIUserAbortError
  );
}

/** Close the source; a failing close must not mask the error that got us here. */
async function closeQuietly(
  iterator: AsyncIterator<ChatCompletionChunk>,
): Promise<void> {
  try {
    await iterator.return?.();
  } catch {
    // Nothing actionable: the stream is already being abandoned.
  }
}

function isErrorChunk(chunk: unknown): boolean {
  const c = chunk as {
    error?: unknown;
    choices?: { finish_reason?: string | null }[];
  };
  return c.error !== undefined || c.choices?.[0]?.finish_reason === "error";
}

interface StreamSummary {
  answeredModel: string | null;
  answeredProvider: string | null;
  cost: number | undefined;
  completed: boolean;
}

async function* wrapStream(
  iterator: AsyncIterator<ChatCompletionChunk>,
  first: IteratorResult<ChatCompletionChunk>,
  onEnd: (summary: StreamSummary) => void,
): AsyncGenerator<ChatCompletionChunk> {
  const summary: StreamSummary = {
    answeredModel: null,
    answeredProvider: null,
    cost: undefined,
    completed: false,
  };
  const note = (c: ChatCompletionChunk) => {
    summary.answeredModel ??= c.model ?? null;
    summary.answeredProvider ??= answeredProvider(c);
    summary.cost = usageCost(c) ?? summary.cost;
  };
  try {
    if (!first.done) {
      note(first.value);
      yield first.value;
    }
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      if (isErrorChunk(next.value)) throw new InStreamError(next.value);
      note(next.value);
      yield next.value;
    }
    summary.completed = true;
  } finally {
    if (!summary.completed) await closeQuietly(iterator);
    onEnd(summary);
  }
}

/** Unflagged rows always carry `fallback` (pinned by ai-models.test.ts). */
function fallbackModel(row: AiFeatureConfig, feature: AiFeature): string {
  if (row.fallback === undefined)
    throw new Error(`aiChat(${feature}): row has no OpenAI fallback`);
  return row.fallback;
}

export function createAiChat(deps: AiChatDeps): AiChat {
  const now = deps.now ?? Date.now;
  const reportedAt = new Map<string, number>();

  /** At most one report per key per CONFIG_REPORT_INTERVAL_MS. */
  function throttledReport(key: string, error: Error): void {
    const t = now();
    const last = reportedAt.get(key);
    if (last !== undefined && t - last < CONFIG_REPORT_INTERVAL_MS) return;
    reportedAt.set(key, t);
    deps.report(error, "ai-client");
  }

  async function run(
    feature: AiFeature,
    params: AiChatParams | AiChatStreamParams,
    options?: AiChatOptions,
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    const row: AiFeatureConfig = AI_FEATURES[feature];
    const ctx: AiCallContext | undefined = getAiCallContext();
    const override = ctx?.overrides[feature];
    const requestedModel = override?.model ?? row.model;
    const fallbackAllowed = ctx?.fallback !== "off";
    const streaming = params.stream === true;

    const record = (
      answeredModel: string | null,
      provider: string | null,
      fellBack: boolean,
    ) => {
      ctx?.calls.push({
        feature,
        requestedModel,
        answeredModel,
        answeredProvider: provider,
        fellBack,
      });
    };

    // Before any OpenAI path below — incl. the no-OpenRouter-key early return.
    if (row.primary === "vertex") {
      return runVertexFirst(
        feature,
        row,
        params,
        options,
        ctx,
        requestedModel,
        record,
      );
    }

    const callFallback = async (reason: FallbackReason, err?: unknown) => {
      deps.log.warn(
        {
          feature,
          provider: "fallback",
          requestedModel,
          fallbackModel: fallbackModel(row, feature),
          fallbackReason: reason,
          ...(err !== undefined && {
            error: {
              status: err instanceof OpenAI.APIError ? err.status : undefined,
              message: (err instanceof Error ? err.message : String(err)).slice(
                0,
                300,
              ),
            },
          }),
        },
        "ai call using fallback",
      );
      const res = await deps.fallback.chat.completions.create(
        { ...params, model: fallbackModel(row, feature) },
        options,
      );
      record(
        streaming ? fallbackModel(row, feature) : answeredModel(res),
        "openai-direct",
        true,
      );
      return res as ChatCompletion | AsyncIterable<ChatCompletionChunk>;
    };

    if (!deps.openrouter) {
      if (!fallbackAllowed) {
        throw new Error(
          `aiChat(${feature}): OPENROUTER_API_KEY is required when fallback is off`,
        );
      }
      // Today's path, byte-for-byte: no warn — this is the normal no-key state.
      const res = await deps.fallback.chat.completions.create(
        { ...params, model: fallbackModel(row, feature) },
        options,
      );
      return res as ChatCompletion | AsyncIterable<ChatCompletionChunk>;
    }

    if (fallbackAllowed && deps.breaker.isOpen())
      return callFallback("circuit-open");

    const host = hostForModel(requestedModel);
    if (!host) {
      // Table rows are pinned by test; only an eval override can get here.
      throw new Error(
        `aiChat(${feature}): no pinned OpenRouter host for "${requestedModel}" (add it to PINNED_HOSTS after the privacy policy names it)`,
      );
    }

    const body = {
      ...adaptParams(params, row.adapt, override?.set),
      model: requestedModel,
      provider: { zdr: true, only: [host] },
    };

    try {
      if (streaming) {
        return await openStream(feature, requestedModel, body, options, record);
      }
      const res = await deps.openrouter.chat.completions.create(body, options);
      deps.breaker.recordSuccess();
      const model = answeredModel(res);
      const provider = answeredProvider(res);
      record(model, provider, false);
      deps.log.info(
        {
          feature,
          provider: "openrouter",
          requestedModel,
          answeredModel: model,
          answeredProvider: provider,
          cost: usageCost(res),
        },
        "ai call",
      );
      return res as ChatCompletion;
    } catch (err) {
      if (isAbort(err, options)) throw err;
      const kind = classifyAiFailure(err);
      if (countsTowardBreaker(kind)) deps.breaker.recordFailure();
      const message = err instanceof Error ? err.message : String(err);
      if (kind === "balance") {
        deps.report(
          new Error(
            "OpenRouter balance exhausted (402) — AI traffic is on the OpenAI fallback",
          ),
          "ai-client",
        );
      } else if (kind === "config") {
        // Throttled per feature; the fallback warn log below still records
        // every failure.
        const status = err instanceof OpenAI.APIError ? err.status : undefined;
        throttledReport(
          `openrouter:${feature}`,
          new Error(
            `AI config error: ${feature} (${String(status)}): ${message}`,
          ),
        );
      }
      if (!fallbackAllowed) {
        // Eval context: say WHY the call failed before the caller's catch eats it.
        ctx?.calls.push({
          feature,
          requestedModel,
          answeredModel: null,
          answeredProvider: null,
          fellBack: false,
          error: {
            kind,
            moderated: kind === "request" && isModerationBlock(err),
            message: message.slice(0, 300),
          },
        });
        throw err;
      }
      return callFallback(kind, err);
    }
  }

  /**
   * Vertex direct → OpenRouter → throw (spec 2026-10-19-vision-rows-vertex-
   * direct §2.3). NEVER calls deps.fallback (OpenAI direct). With the
   * fallback off (evals) only the first available route is tried.
   */
  async function runVertexFirst(
    feature: AiFeature,
    row: AiFeatureConfig,
    params: AiChatParams | AiChatStreamParams,
    options: AiChatOptions | undefined,
    ctx: AiCallContext | undefined,
    requestedModel: string,
    record: (
      answeredModel: string | null,
      provider: string | null,
      fellBack: boolean,
    ) => void,
  ): Promise<ChatCompletion> {
    if (params.stream === true) {
      throw new Error(
        `aiChat(${feature}): streaming is not supported on a Vertex-first row`,
      );
    }
    const evalMode = ctx?.fallback === "off";
    const override = ctx?.overrides[feature];
    const adapted = {
      ...adaptParams(params, row.adapt, override?.set),
      model: requestedModel,
    };
    const statusOf = (err: unknown) =>
      err instanceof OpenAI.APIError ? err.status : undefined;
    const messageOf = (err: unknown) =>
      (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const recordEvalError = (kind: AiFailureKind, err: unknown) => {
      ctx?.calls.push({
        feature,
        requestedModel,
        answeredModel: null,
        answeredProvider: null,
        fellBack: false,
        error: {
          kind,
          moderated: kind === "request" && isModerationBlock(err),
          message: messageOf(err),
        },
      });
    };

    let lastErr: unknown;

    // 1. Vertex
    let vertexSkip: string | null = null;
    if (!deps.vertex) vertexSkip = "not configured (GOOGLE_VERTEX_*)";
    else if (!evalMode && deps.vertexBreaker.isOpen())
      vertexSkip = "circuit open";
    else {
      try {
        const res = await deps.vertex.chat.completions.create(adapted, options);
        deps.vertexBreaker.recordSuccess();
        const model = answeredModel(res);
        record(model, "vertex", false);
        deps.log.info(
          {
            feature,
            provider: "vertex",
            requestedModel,
            answeredModel: model,
            usage: (res as { usage?: unknown }).usage,
          },
          "ai call",
        );
        return res as ChatCompletion;
      } catch (err) {
        if (isAbort(err, options)) throw err;
        const kind = classifyAiFailure(err);
        if (countsTowardBreaker(kind)) deps.vertexBreaker.recordFailure();
        if (kind === "config") {
          throttledReport(
            `vertex:${feature}`,
            new Error(
              `AI config error: ${feature} (vertex) (${String(statusOf(err))}): ${messageOf(err)}`,
            ),
          );
        }
        if (evalMode) {
          recordEvalError(kind, err);
          throw err;
        }
        lastErr = err;
        deps.log.warn(
          {
            feature,
            provider: "openrouter",
            requestedModel,
            fallbackReason: kind,
            error: { status: statusOf(err), message: messageOf(err) },
          },
          "ai call using fallback",
        );
      }
    }

    // 2. OpenRouter (pinned Vertex host, ZDR)
    let openrouterSkip: string | null = null;
    if (!deps.openrouter)
      openrouterSkip = "not configured (OPENROUTER_API_KEY)";
    else if (!evalMode && deps.breaker.isOpen())
      openrouterSkip = "circuit open";
    else {
      const host = hostForModel(requestedModel);
      if (!host) {
        throw new Error(
          `aiChat(${feature}): no pinned OpenRouter host for "${requestedModel}"`,
        );
      }
      try {
        const res = await deps.openrouter.chat.completions.create(
          { ...adapted, provider: { zdr: true, only: [host] } },
          options,
        );
        deps.breaker.recordSuccess();
        const model = answeredModel(res);
        const provider = answeredProvider(res);
        record(model, provider, lastErr !== undefined);
        deps.log.info(
          {
            feature,
            provider: "openrouter",
            requestedModel,
            answeredModel: model,
            answeredProvider: provider,
            cost: usageCost(res),
          },
          "ai call",
        );
        return res as ChatCompletion;
      } catch (err) {
        if (isAbort(err, options)) throw err;
        const kind = classifyAiFailure(err);
        if (countsTowardBreaker(kind)) deps.breaker.recordFailure();
        if (kind === "balance") {
          deps.report(
            new Error(
              `OpenRouter balance exhausted (402) — ${feature} has no fallback while Vertex is failing`,
            ),
            "ai-client",
          );
        } else if (kind === "config") {
          throttledReport(
            `openrouter:${feature}`,
            new Error(
              `AI config error: ${feature} (${String(statusOf(err))}): ${messageOf(err)}`,
            ),
          );
        }
        if (evalMode) {
          recordEvalError(kind, err);
          throw err;
        }
        lastErr = err;
      }
    }

    // 3. Neither route answered — never OpenAI.
    if (lastErr !== undefined) {
      throttledReport(
        `unavailable:${feature}`,
        new Error(
          `AI unavailable: ${feature} — Vertex and OpenRouter both failed or were skipped`,
        ),
      );
      throw lastErr;
    }
    throw new Error(
      `aiChat(${feature}): no AI route available (vertex: ${vertexSkip}; openrouter: ${openrouterSkip}) — set GOOGLE_VERTEX_* and/or OPENROUTER_API_KEY`,
    );
  }

  async function openStream(
    feature: AiFeature,
    requestedModel: string,
    body: Record<string, unknown>,
    options: AiChatOptions | undefined,
    record: (
      answeredModel: string | null,
      provider: string | null,
      fellBack: boolean,
    ) => void,
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const source = (await deps.openrouter!.chat.completions.create(
      body,
      options,
    )) as AsyncIterable<ChatCompletionChunk>;
    const iterator = source[Symbol.asyncIterator]();
    // Peek: any SSE event — role-only or tool-call deltas included — counts as
    // "the caller has received something" once we return (spec §3.5).
    const first = await iterator.next();
    if (!first.done && isErrorChunk(first.value)) {
      await closeQuietly(iterator);
      throw new InStreamError(first.value);
    }
    deps.breaker.recordSuccess();
    return wrapStream(iterator, first, (summary) => {
      record(summary.answeredModel, summary.answeredProvider, false);
      deps.log.info(
        { feature, provider: "openrouter", requestedModel, ...summary },
        "ai stream",
      );
    });
  }

  return run as AiChat;
}

export function createOpenRouterClient(
  env: Record<string, string | undefined> = process.env,
): AiChatClient | null {
  const key = env.OPENROUTER_API_KEY?.trim() || undefined;
  if (!key) return null;
  // `as unknown` is required (TS2352): the SDK's overloaded create() takes typed
  // params, AiChatClient takes the adapted Record body.
  return new OpenAI({
    apiKey: key,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: { "X-Title": "OCRecipes" },
    timeout: AI_ROUTE_TIMEOUT_MS,
    maxRetries: AI_ROUTE_MAX_RETRIES,
  }) as unknown as AiChatClient;
}

function defaultDeps(): AiChatDeps {
  return {
    openrouter: createOpenRouterClient(),
    vertex: createVertexClient(),
    fallback: openai as unknown as AiChatClient,
    breaker: new CircuitBreaker(),
    vertexBreaker: new CircuitBreaker(),
    report: (error, context) => reportError(error, context),
    log: createServiceLogger("ai-client"),
  };
}

export const aiChat: AiChat = createAiChat(defaultDeps());
