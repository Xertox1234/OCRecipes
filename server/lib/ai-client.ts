/**
 * The single entry point for chat/vision completions (spec §3.2). Rows with
 * `primary: "vertex"` route Vertex AI direct → OpenRouter (spec
 * 2026-10-19-vision-rows-vertex-direct). Every other row routes OpenRouter
 * (zero-data-retention) → the Vertex AI direct backup (spec
 * 2026-11-02-vertex-backup-route-design §3). No path reaches OpenAI direct.
 * Never call `chat.completions.create` elsewhere —
 * ocrecipes/no-direct-chat-completions.
 */
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import {
  AI_FEATURES,
  adaptParams,
  hostForModel,
  VERTEX_BACKUP_REASONING_HEADROOM,
} from "./ai-models";
import type { AiAdapt, AiFeature, AiFeatureConfig } from "./ai-models";
import { getAiCallContext, withAiCallContext } from "./ai-call-context";
import type {
  AiCallContext,
  AiCallRecord,
  AiCallUsage,
} from "./ai-call-context";
import {
  CircuitBreaker,
  classifyAiFailure,
  countsTowardBreaker,
  InStreamError,
  isModerationBlock,
} from "./ai-failure";
import type { AiFailureKind } from "./ai-failure";
import {
  OPENAI_TIMEOUT_FAST_MS,
  VERTEX_BACKUP_TIMEOUT_FAST_MS,
} from "./openai";
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
  /** The Vertex backup leg's timeout, when it needs longer than `timeout`. */
  backupTimeout?: number;
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
  breaker: CircuitBreaker;
  /** Separate from `breaker` (= OpenRouter health): one route's outage never trips the other. */
  vertexBreaker: CircuitBreaker;
  report: (error: Error, context: string) => void;
  log: {
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
  };
  now?: () => number;
  /** Injected so tests skip the wait before a Vertex 429 retry. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The wait before the Vertex backup's one retry after a 429 (owner
 * 2026-11-03: Vertex's shared capacity answered 429 on 2 of 84 gate calls).
 * Timeouts are never retried: that would double the user's wait.
 */
export const VERTEX_BUSY_RETRY_MS = 1000;

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

const statusOf = (err: unknown) =>
  err instanceof OpenAI.APIError ? err.status : undefined;
const messageOf = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 300);

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

/**
 * OpenRouter's in-stream error shape: a chunk with `error` and/or
 * `finish_reason: "error"`. Vertex's OpenAI-compatible endpoint has no
 * documented chunk-level error; whatever it sends as an SSE `error` event or
 * a `data:` payload with `error` is raised by the openai SDK itself as an
 * APIError from `next()` (node_modules/openai/core/streaming.js, v6.39), so
 * both routes end a failed stream with a throw, never a silent truncation.
 */
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
  finishReason: string | null;
  usage: AiCallUsage | undefined;
}

type CallOutcome = Pick<AiCallRecord, "finishReason" | "usage">;
type RecordCall = (
  answeredModel: string | null,
  provider: string | null,
  fellBack: boolean,
  outcome?: CallOutcome,
) => void;

/** Eval-record outcome of a non-stream completion (spec PR 2 gate). */
function completionOutcome(res: unknown): CallOutcome {
  const r = res as {
    choices?: { finish_reason?: string | null }[];
    usage?: AiCallUsage;
  };
  return {
    finishReason: r.choices?.[0]?.finish_reason ?? null,
    usage: r.usage,
  };
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
    finishReason: null,
    usage: undefined,
  };
  const note = (c: ChatCompletionChunk) => {
    summary.answeredModel ??= c.model ?? null;
    summary.answeredProvider ??= answeredProvider(c);
    summary.cost = usageCost(c) ?? summary.cost;
    summary.finishReason =
      c.choices?.[0]?.finish_reason ?? summary.finishReason;
    summary.usage =
      (c.usage as AiCallUsage | null | undefined) ?? summary.usage;
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

/**
 * Gemini on Vertex direct 400s on tool history whose calls lack a thought
 * signature (foreign history from another model, or the 2nd+ parallel call,
 * which Gemini sends unsigned). Google's documented placeholder skips the
 * check; a real signature is never overwritten. Vertex bodies only — the
 * OpenRouter body is never touched (spec 2026-11-02-vertex-backup-route-
 * design §2, §3.4). Pure: returns new objects, input unmodified.
 */
const PLACEHOLDER_SIGNATURE = "skip_thought_signature_validator";

interface ToolCallLike {
  extra_content?: { google?: { thought_signature?: unknown } };
}

export function fillThoughtSignatures(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m: unknown) => {
    const msg = m as { role?: unknown; tool_calls?: unknown };
    if (msg?.role !== "assistant" || !Array.isArray(msg.tool_calls)) return m;
    return {
      ...msg,
      tool_calls: msg.tool_calls.map((c: ToolCallLike) =>
        c?.extra_content?.google?.thought_signature !== undefined
          ? c
          : {
              ...c,
              extra_content: {
                ...c.extra_content,
                google: {
                  ...c.extra_content?.google,
                  thought_signature: PLACEHOLDER_SIGNATURE,
                },
              },
            },
      ),
    };
  });
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
    callerOptions?: AiChatOptions,
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    // `backupTimeout` is ours, never the SDK's: strip it, and give it to the
    // Vertex backup leg as that leg's timeout. A 15 s "fast" caller gets 30 s
    // there by default (owner 2026-11-03: Vertex timed out at 15 s in the
    // PR 3 gate).
    const { backupTimeout: explicit, ...sdkOptions } = callerOptions ?? {};
    const backupTimeout =
      explicit ??
      (callerOptions?.timeout === OPENAI_TIMEOUT_FAST_MS
        ? VERTEX_BACKUP_TIMEOUT_FAST_MS
        : undefined);
    const options = explicit === undefined ? callerOptions : sdkOptions;
    const backupOptions =
      backupTimeout === undefined
        ? callerOptions
        : { ...sdkOptions, timeout: backupTimeout };
    const row: AiFeatureConfig = AI_FEATURES[feature];
    const ctx: AiCallContext | undefined = getAiCallContext();
    const override = ctx?.overrides[feature];
    const requestedModel = override?.model ?? row.model;
    const fallbackAllowed = ctx?.fallback !== "off";
    const streaming = params.stream === true;

    const record: RecordCall = (answeredModel, provider, fellBack, outcome) => {
      ctx?.calls.push({
        feature,
        requestedModel,
        answeredModel,
        answeredProvider: provider,
        fellBack,
        ...outcome,
      });
    };

    // Eval/smoke switch (ai-call-context.ts); beats `fallback: "off"`, and comes
    // before the Vertex-first dispatch so it is never silently ignored.
    const force = ctx?.forceBackup;
    if (
      force !== undefined &&
      (typeof force === "function" ? force(ctx!.calls.length) : force)
    ) {
      if (!row.vertexBackup) {
        throw new Error(
          `aiChat(${feature}): forceBackup on a row with no vertexBackup`,
        );
      }
      return callVertexBackup(
        feature,
        row,
        params,
        backupOptions,
        undefined,
        "forced",
        record,
      );
    }

    // Before the OpenRouter path below — incl. the no-OpenRouter-key early return.
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

    if (!deps.openrouter) {
      if (!fallbackAllowed) {
        throw new Error(
          `aiChat(${feature}): OPENROUTER_API_KEY is required when fallback is off`,
        );
      }
      if (!deps.vertex) {
        throw new Error(
          `aiChat(${feature}): no AI route — set OPENROUTER_API_KEY and/or GOOGLE_VERTEX_*`,
        );
      }
      return callVertexBackup(
        feature,
        row,
        params,
        backupOptions,
        undefined,
        "config",
        record,
      );
    }

    if (fallbackAllowed && deps.breaker.isOpen()) {
      return callVertexBackup(
        feature,
        row,
        params,
        backupOptions,
        undefined,
        "circuit-open",
        record,
      );
    }

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
        return await openStream(
          deps.openrouter,
          deps.breaker,
          "openrouter",
          feature,
          requestedModel,
          body,
          options,
          record,
          false,
        );
      }
      const res = await deps.openrouter.chat.completions.create(body, options);
      deps.breaker.recordSuccess();
      const model = answeredModel(res);
      const provider = answeredProvider(res);
      record(model, provider, false, completionOutcome(res));
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
            `OpenRouter balance exhausted (402) — ${feature} is on the Vertex backup`,
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
      return callVertexBackup(
        feature,
        row,
        params,
        backupOptions,
        err,
        kind,
        record,
      );
    }
  }

  /** `client`, but a 429 is retried once after VERTEX_BUSY_RETRY_MS. */
  function retryOnceWhenBusy(client: AiChatClient): AiChatClient {
    const sleep =
      deps.sleep ??
      ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    return {
      chat: {
        completions: {
          create: async (body, options) => {
            try {
              return await client.chat.completions.create(body, options);
            } catch (err) {
              if (statusOf(err) !== 429 || options?.signal?.aborted) throw err;
              await sleep(VERTEX_BUSY_RETRY_MS);
              return client.chat.completions.create(body, options);
            }
          },
        },
      },
    };
  }

  /** The backup body with VERTEX_BACKUP_REASONING_HEADROOM on its cap. */
  function withThinkingRoom(
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const out = { ...body };
    for (const key of ["max_completion_tokens", "max_tokens"])
      if (typeof out[key] === "number")
        out[key] = (out[key] as number) + VERTEX_BACKUP_REASONING_HEADROOM;
    return out;
  }

  /** The adapted body for a Vertex-direct call: no `provider` key. */
  function buildVertexBody(
    params: AiChatParams | AiChatStreamParams,
    adapt: AiAdapt | undefined,
    model: string,
    extraSet?: Record<string, unknown>,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      ...adaptParams(params, adapt, extraSet),
      model,
    };
    return { ...body, messages: fillThoughtSignatures(body.messages) };
  }

  /**
   * The Vertex-direct backup for a `vertexBackup` row (spec 2026-11-02-
   * vertex-backup-route-design §3.2 step 2).
   * `openrouterErr` is undefined when OpenRouter was never tried (breaker
   * open, no key, forced).
   */
  async function callVertexBackup(
    feature: AiFeature,
    row: AiFeatureConfig,
    params: AiChatParams | AiChatStreamParams,
    options: AiChatOptions | undefined,
    openrouterErr: unknown,
    reason: FallbackReason | "forced",
    record: RecordCall,
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    const backup = row.vertexBackup!;
    // A forced call is a local smoke run, not an outage worth reporting.
    const reportUnavailable = (msg: string) => {
      if (reason !== "forced")
        throttledReport(`unavailable:${feature}`, new Error(msg));
    };

    const skip = !deps.vertex
      ? "not configured (GOOGLE_VERTEX_*)"
      : deps.vertexBreaker.isOpen()
        ? "circuit open"
        : null;
    if (skip !== null || !deps.vertex) {
      reportUnavailable(
        `AI unavailable: ${feature} — OpenRouter ${openrouterErr !== undefined ? "failed" : `not tried (${reason})`} and the Vertex backup is ${skip}`,
      );
      if (openrouterErr !== undefined) throw openrouterErr;
      throw new Error(
        `aiChat(${feature}): both routes unavailable (openrouter: ${reason}; vertex backup: ${skip})`,
      );
    }

    deps.log.warn(
      {
        feature,
        provider: "vertex",
        backupModel: backup.model,
        fallbackReason: reason,
        ...(openrouterErr !== undefined && {
          error: {
            status: statusOf(openrouterErr),
            message: messageOf(openrouterErr),
          },
        }),
      },
      "ai call using fallback",
    );
    const body = withThinkingRoom(
      buildVertexBody(params, backup.adapt, backup.model),
    );
    const vertex = retryOnceWhenBusy(deps.vertex);
    try {
      if (params.stream === true) {
        return await openStream(
          vertex,
          deps.vertexBreaker,
          "vertex",
          feature,
          backup.model,
          body,
          options,
          record,
          true,
        );
      }
      const res = await vertex.chat.completions.create(body, options);
      deps.vertexBreaker.recordSuccess();
      const model = answeredModel(res);
      record(model, "vertex", true, completionOutcome(res));
      deps.log.info(
        {
          feature,
          provider: "vertex",
          requestedModel: backup.model,
          answeredModel: model,
          fellBack: true,
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
            `AI config error: ${feature} (vertex backup) (${String(statusOf(err))}): ${messageOf(err)}`,
          ),
        );
      }
      reportUnavailable(
        `AI unavailable: ${feature} — OpenRouter and the Vertex backup both failed`,
      );
      throw err;
    }
  }

  /**
   * Vertex direct → OpenRouter → throw (spec 2026-10-19-vision-rows-vertex-
   * direct §2.3). With the
   * fallback off (evals) only the first available route is tried.
   */
  async function runVertexFirst(
    feature: AiFeature,
    row: AiFeatureConfig,
    params: AiChatParams | AiChatStreamParams,
    options: AiChatOptions | undefined,
    ctx: AiCallContext | undefined,
    requestedModel: string,
    record: RecordCall,
  ): Promise<ChatCompletion> {
    if (params.stream === true) {
      throw new Error(
        `aiChat(${feature}): streaming is not supported on a Vertex-first row`,
      );
    }
    const evalMode = ctx?.fallback === "off";
    const override = ctx?.overrides[feature];
    const adapted = buildVertexBody(
      params,
      row.adapt,
      requestedModel,
      override?.set,
    );
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
        record(model, "vertex", false, completionOutcome(res));
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
        // OpenRouter gets the caller's history, never the Vertex placeholder.
        const res = await deps.openrouter.chat.completions.create(
          {
            ...adaptParams(params, row.adapt, override?.set),
            model: requestedModel,
            provider: { zdr: true, only: [host] },
          },
          options,
        );
        deps.breaker.recordSuccess();
        const model = answeredModel(res);
        const provider = answeredProvider(res);
        record(model, provider, lastErr !== undefined, completionOutcome(res));
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

  /**
   * Open a stream and peek its first event; a failure up to and including
   * that event throws to the caller's catch (which may switch routes). After
   * it, failures reach the stream's consumer (spec §3.5 / 2026-11-02 §3.3).
   */
  async function openStream(
    client: AiChatClient,
    breaker: CircuitBreaker,
    provider: "openrouter" | "vertex",
    feature: AiFeature,
    requestedModel: string,
    body: Record<string, unknown>,
    options: AiChatOptions | undefined,
    record: RecordCall,
    fellBack: boolean,
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    const source = (await client.chat.completions.create(
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
    breaker.recordSuccess();
    return wrapStream(iterator, first, (summary) => {
      // Vertex chunks carry no `provider` field: the route is the answer.
      const answered =
        provider === "vertex" ? "vertex" : summary.answeredProvider;
      record(summary.answeredModel, answered, fellBack, {
        finishReason: summary.finishReason,
        usage: summary.usage,
      });
      deps.log.info(
        { feature, provider, requestedModel, fellBack, ...summary },
        "ai stream",
      );
    });
  }

  return run as AiChat;
}

function defaultDeps(): AiChatDeps {
  const key = process.env.OPENROUTER_API_KEY?.trim() || undefined;
  // `as unknown` is required (TS2352): the SDK's overloaded create() takes typed
  // params, AiChatClient takes the adapted Record body.
  return {
    openrouter: key
      ? (new OpenAI({
          apiKey: key,
          baseURL: OPENROUTER_BASE_URL,
          defaultHeaders: { "X-Title": "OCRecipes" },
          maxRetries: 0, // the Vertex backup is the retry
        }) as unknown as AiChatClient)
      : null,
    vertex: createVertexClient(),
    breaker: new CircuitBreaker(),
    vertexBreaker: new CircuitBreaker(),
    report: (error, context) => reportError(error, context),
    log: createServiceLogger("ai-client"),
  };
}

export const aiChat: AiChat = createAiChat(defaultDeps());
