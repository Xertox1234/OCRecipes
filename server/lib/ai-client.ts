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
import { AI_FEATURES, adaptParams } from "./ai-models";
import type { AiFeature, AiFeatureConfig } from "./ai-models";
import { getAiCallContext, withAiCallContext } from "./ai-call-context";
import type { AiCallContext } from "./ai-call-context";
import {
  CircuitBreaker,
  classifyAiFailure,
  countsTowardBreaker,
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

type FallbackReason = AiFailureKind | "no-key" | "circuit-open";

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

export function createAiChat(deps: AiChatDeps): AiChat {
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

    const callFallback = async (reason: FallbackReason) => {
      deps.log.warn(
        {
          feature,
          provider: "fallback",
          requestedModel,
          fallbackModel: row.fallback,
          fallbackReason: reason,
        },
        "ai call using fallback",
      );
      const res = await deps.fallback.chat.completions.create(
        { ...params, model: row.fallback },
        options,
      );
      record(
        streaming ? row.fallback : (res as ChatCompletion).model,
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

    const body = {
      ...adaptParams(
        params as unknown as Record<string, unknown>,
        row.adapt,
        override?.set,
      ),
      model: requestedModel,
      provider: { zdr: true },
    };

    try {
      if (streaming) {
        return await openStream(feature, requestedModel, body, options, record); // Task 5
      }
      const res = await deps.openrouter.chat.completions.create(body, options);
      deps.breaker.recordSuccess();
      const completion = res as ChatCompletion;
      const provider = answeredProvider(res);
      record(completion.model, provider, false);
      deps.log.info(
        {
          feature,
          provider: "openrouter",
          requestedModel,
          answeredModel: completion.model,
          answeredProvider: provider,
          cost: usageCost(res),
        },
        "ai call",
      );
      return completion;
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
        const status = err instanceof OpenAI.APIError ? err.status : undefined;
        deps.report(
          new Error(
            `AI config error: ${feature} (${String(status)}): ${message}`,
          ),
          "ai-client",
        );
      }
      if (!fallbackAllowed) throw err;
      return callFallback(kind);
    }
  }

  // Placeholder replaced in Task 5 — streaming is not routed yet.
  async function openStream(
    ..._args: unknown[]
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    throw new Error("aiChat streaming lands in Task 5");
  }

  return run as AiChat;
}

function defaultDeps(): AiChatDeps {
  const key = process.env.OPENROUTER_API_KEY;
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
