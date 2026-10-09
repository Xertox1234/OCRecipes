/**
 * The single entry point for chat/vision completions (spec §3.2). Routes via
 * OpenRouter (zero-data-retention) when OPENROUTER_API_KEY is set, else via
 * today's OpenAI client; falls back per spec §3.4. Never call
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
  CircuitBreaker,
  classifyAiFailure,
  countsTowardBreaker,
  InStreamError,
  isModerationBlock,
} from "./ai-failure";
import type { AiFailureKind } from "./ai-failure";
import { openai } from "./openai";
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
  fallback: AiChatClient;
  breaker: CircuitBreaker;
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

export function createAiChat(deps: AiChatDeps): AiChat {
  const now = deps.now ?? Date.now;
  const configReportedAt = new Map<AiFeature, number>();

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

    const callFallback = async (reason: FallbackReason, err?: unknown) => {
      deps.log.warn(
        {
          feature,
          provider: "fallback",
          requestedModel,
          fallbackModel: row.fallback,
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
        { ...params, model: row.fallback },
        options,
      );
      record(
        streaming ? row.fallback : answeredModel(res),
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
        { ...params, model: row.fallback },
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
        const t = now();
        const last = configReportedAt.get(feature);
        if (last === undefined || t - last >= CONFIG_REPORT_INTERVAL_MS) {
          configReportedAt.set(feature, t);
          const status =
            err instanceof OpenAI.APIError ? err.status : undefined;
          deps.report(
            new Error(
              `AI config error: ${feature} (${String(status)}): ${message}`,
            ),
            "ai-client",
          );
        }
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
        }) as unknown as AiChatClient)
      : null,
    fallback: openai as unknown as AiChatClient,
    breaker: new CircuitBreaker(),
    report: (error, context) => reportError(error, context),
    log: createServiceLogger("ai-client"),
  };
}

export const aiChat: AiChat = createAiChat(defaultDeps());
