import { aiChat } from "../lib/ai-client";
import { OPENAI_TIMEOUT_STREAM_MS } from "../lib/openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  sanitizeUserInput,
  sanitizeContextField,
  containsUnsafeCoachAdvice,
} from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";
import {
  getToolDefinitions,
  executeToolCall,
  MAX_TOOL_CALLS_PER_RESPONSE,
  serviceUnavailable,
  type ExecuteToolOptions,
} from "./coach-tools";
import { classifyIntent, type CoachIntent } from "./coach-intent-classifier";
import { isRecipeFinderEnabled } from "./recipe-finder/config";
import { OFFER_RECIPE_TOOL } from "./recipe-finder/offer";
import { getBlocksSystemPrompt } from "./coach-blocks";
import { buildSystemPrompt, type CoachContext } from "./coach-prompt";
import { releasableLength } from "./coach-sentence-release";
import type { UserProfile } from "@shared/schema";

const log = createServiceLogger("nutrition-coach");

/**
 * Tool definitions are static — hoist to module scope so we build the array
 * once at module load instead of per-request inside generateCoachProResponse.
 * `Object.freeze` traps accidental top-level mutation (e.g. a future caller
 * pushing extra tools) since this reference is now shared across requests.
 */
export const TOOL_DEFINITIONS = Object.freeze(getToolDefinitions());
/** Write-card mode's list (spec 2026-11-09) — same hoisting, built once. */
export const WRITE_CARD_TOOL_DEFINITIONS = Object.freeze(
  getToolDefinitions({ writeCards: true }),
);
/** Write-card mode plus the pantry card (spec 2026-11-16). */
export const PANTRY_CARD_TOOL_DEFINITIONS = Object.freeze(
  getToolDefinitions({ writeCards: true, pantryCard: true }),
);
/** Write-card mode plus the goals card (Coach roadmap T1), without and with
 *  the pantry card. */
const GOALS_CARD_TOOL_DEFINITIONS = Object.freeze(
  getToolDefinitions({ writeCards: true, goalsCard: true }),
);
const PANTRY_GOALS_CARD_TOOL_DEFINITIONS = Object.freeze(
  getToolDefinitions({ writeCards: true, pantryCard: true, goalsCard: true }),
);

/** The hoisted list for a write-card turn's extra card kinds. */
function writeCardToolList(pantryCard: boolean, goalsCard: boolean) {
  if (goalsCard) {
    return pantryCard
      ? PANTRY_GOALS_CARD_TOOL_DEFINITIONS
      : GOALS_CARD_TOOL_DEFINITIONS;
  }
  return pantryCard
    ? PANTRY_CARD_TOOL_DEFINITIONS
    : WRITE_CARD_TOOL_DEFINITIONS;
}

/**
 * Sentinel yielded by generateCoachResponse when the safety check fires after
 * streaming has already begun. The caller (handleCoachChat) converts this to a
 * safety_override SSE event so the client can reset and display the safe message.
 */
export const SAFETY_OVERRIDE_SENTINEL = "\x00SAFETY_OVERRIDE\x00";

/**
 * Chunk yielded by generateCoachProResponse. A `tool_calls` chunk is yielded
 * as soon as a tool round is detected — before the tools run — so the caller
 * can surface a status event on the wire immediately instead of waiting for
 * the next `content` chunk (a generator can't yield from inside the
 * Promise.all that executes the tool calls, so this replaces the old
 * onBeforeToolCalls callback with a direct yield).
 */
export type CoachProChunk =
  | { type: "content"; content: string }
  // The reply failed the unsafe-advice check after some of it was shown (or
  // before any was): the caller replaces everything with the safety message.
  // Ends the generator.
  | { type: "safety_override" }
  | {
      type: "tool_calls";
      toolNames: string[];
      // Name + raw argument string per call, for the step labels (show-the-
      // work spec 2026-11-09). Optional so a chunk with names only still works.
      calls?: { name: string; arguments: string }[];
    }
  // offer_recipe is terminal: the round's other calls are dropped and the
  // generator returns. `args` is the raw accumulated arguments string.
  | { type: "terminal_tool"; name: "offer_recipe"; args: string };

/** Sanitize all persisted roles before they enter a coach prompt. */
function prepareCoachMessages(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
) {
  const clean = (m: (typeof messages)[number]) =>
    m.role === "user"
      ? sanitizeUserInput(m.content)
      : sanitizeContextField(m.content);
  return messages.map((m) => ({ role: m.role, content: clean(m) }));
}

export async function* generateCoachResponse(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: CoachContext,
  abortSignal?: AbortSignal,
  /**
   * Pre-classified intent from the caller. When provided, the internal
   * `classifyIntent` call is skipped — `handleCoachChat` already classifies
   * once per turn for the cache key, so passing it avoids redundant work.
   * Callers that omit it self-classify the last user message.
   */
  intent?: CoachIntent,
  /** IANA timezone of the requesting user — renders the prompt's "Current time" line. */
  tz: string = "UTC",
): AsyncGenerator<string> {
  const lastUserMessage =
    messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const resolvedIntent =
    intent ?? classifyIntent(lastUserMessage, { recipeRequests: false }).intent;
  const systemPrompt = buildSystemPrompt(context, resolvedIntent, {
    tz,
    tier: "free",
  });

  // Sanitize all persisted roles before including conversation history.
  const sanitizedMessages = prepareCoachMessages(messages);

  let stream;
  try {
    stream = await aiChat(
      "coach-chat",
      {
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          ...sanitizedMessages,
        ],
        max_completion_tokens: 1500,
        temperature: 0.5,
      },
      { timeout: OPENAI_TIMEOUT_STREAM_MS, signal: abortSignal },
    );
  } catch (error) {
    if (abortSignal?.aborted) {
      // Aborted (client disconnect or SSE timeout) before
      // any content arrived — expected, not a failure.
      log.debug({ err: toError(error) }, "coach stream aborted");
      return;
    }
    log.error({ err: toError(error) }, "coach API error");
    yield "Sorry, I'm having trouble responding right now. Please try again.";
    return;
  }

  let fullResponse = "";

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        yield delta; // stream each token to the caller as it arrives
      }
    }
  } catch (error) {
    if (abortSignal?.aborted) {
      // A client disconnect or SSE timeout aborts the
      // OpenAI stream — the expected exit, not a failure. The interrupted-
      // message yield below is skipped: the caller breaks out of its own
      // loop on `isAborted()` before this event would ever reach the client.
      log.debug({ err: toError(error) }, "coach stream aborted");
      return;
    }
    log.error({ err: toError(error) }, "coach streaming error");
    yield "Sorry, the response was interrupted. Please try again.";
    return;
  }

  if (containsUnsafeCoachAdvice(fullResponse)) {
    // Deltas already sent — signal caller to replace content client-side
    yield SAFETY_OVERRIDE_SENTINEL;
    return;
  }
  // No final yield — individual deltas are already in the caller's buffer
}

/**
 * Coach Pro response generator with tool calling support.
 * Yields text chunks while handling OpenAI tool calls internally.
 */
export async function* generateCoachProResponse(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: CoachContext,
  userId: string,
  abortSignal?: AbortSignal,
  preloadedProfile?: UserProfile | null,
  /**
   * Pre-classified intent from the caller. When provided, the internal
   * `classifyIntent` call is skipped — `handleCoachChat` already classifies
   * once per turn for the cache key, so passing it avoids redundant work.
   * Callers that omit it self-classify the last user message.
   */
  intent?: CoachIntent,
  /** IANA timezone of the requesting user — threads through to day-bucketed tool calls and the prompt's "Current time" line. */
  tz: string = "UTC",
  options?: {
    offerRecipe?: boolean;
    /** The app can show write cards (spec 2026-11-09). */
    writeCards?: boolean;
    /** The app can show the pantry card and the plan has the pantry. */
    pantryCard?: boolean;
    /** The app can show the goals card. */
    goalsCard?: boolean;
    onWriteCardProposal?: ExecuteToolOptions["onWriteCardProposal"];
    planRecipePool?: ExecuteToolOptions["planRecipePool"];
  },
): AsyncGenerator<CoachProChunk> {
  const lastUserMessage =
    messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const resolvedIntent =
    intent ?? classifyIntent(lastUserMessage, { recipeRequests: false }).intent;
  // One flag drives both the tool and the prompt rule so the model is never
  // told to call a tool it does not have (safety turns get neither).
  const offerTool =
    !!options?.offerRecipe &&
    isRecipeFinderEnabled() &&
    !!context.blocksPrompt &&
    resolvedIntent !== "safety_refusal";
  const promptContext: CoachContext = offerTool
    ? {
        ...context,
        blocksPrompt: getBlocksSystemPrompt(isRecipeFinderEnabled(), {
          offer: true,
          writeCards: !!options?.writeCards,
        }),
      }
    : context;
  const systemPrompt = buildSystemPrompt(promptContext, resolvedIntent, {
    tz,
    tier: "pro",
  });
  // Shallow-copy the frozen module-level array so the SDK can accept it
  // (its types require a mutable `ChatCompletionTool[]`). The copy is O(n)
  // over references, not over the full tool tree — still far cheaper than
  // re-running `getToolDefinitions()` per request.
  // With the recipe finder on, search_recipes is retired: otherwise the model
  // could still call it on any message the classifier does not route to
  // recipe_request and give the prose "couldn't find" answer the finder
  // replaces (spec §3.3). Flag off → today's tools.
  const toolList = !options?.writeCards
    ? TOOL_DEFINITIONS
    : writeCardToolList(!!options.pantryCard, !!options.goalsCard);
  const baseTools = isRecipeFinderEnabled()
    ? toolList.filter(
        (t) => !("function" in t && t.function.name === "search_recipes"),
      )
    : [...toolList];
  const tools = offerTool ? [...baseTools, OFFER_RECIPE_TOOL] : baseTools;

  const sanitizedMessages = prepareCoachMessages(messages);

  // Build the conversation with system prompt
  const conversation: {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }[];
    tool_call_id?: string;
  }[] = [{ role: "system", content: systemPrompt }, ...sanitizedMessages];

  let toolCallCount = 0;
  let fullResponse = "";

  while (toolCallCount <= MAX_TOOL_CALLS_PER_RESPONSE) {
    let stream;
    try {
      stream = await aiChat(
        "coach-pro-chat",
        {
          stream: true,
          messages: conversation as ChatCompletionMessageParam[],
          tools,
          max_completion_tokens: 1500,
          temperature: 0.5,
        },
        { timeout: OPENAI_TIMEOUT_STREAM_MS, signal: abortSignal },
      );
    } catch (error) {
      if (abortSignal?.aborted) {
        // Aborted (client disconnect or SSE timeout)
        // before any content arrived — expected, not a failure.
        log.debug({ err: toError(error) }, "coach pro stream aborted");
        return;
      }
      log.error({ err: toError(error) }, "coach pro API error");
      yield {
        type: "content",
        content:
          "Sorry, I'm having trouble responding right now. Please try again.",
      };
      return;
    }

    // Track tool calls being built from stream deltas
    let finishReason: string | null = null;
    const pendingToolCalls: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();
    let contentInThisRound = "";
    // How much of this round has been checked and yielded. Text is released
    // a finished sentence at a time, each release checked together with
    // everything before it (coach-sentence-release.ts).
    let releasedInRound = 0;
    const textBeforeRound = fullResponse;

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        // Stream text to the caller a vetted sentence at a time
        const textDelta = choice.delta?.content;
        if (textDelta) {
          contentInThisRound += textDelta;
          fullResponse += textDelta;
          const pending = contentInThisRound.slice(releasedInRound);
          const len = releasableLength(pending);
          if (len > 0) {
            const upTo = releasedInRound + len;
            if (
              containsUnsafeCoachAdvice(
                textBeforeRound + contentInThisRound.slice(0, upTo),
              )
            ) {
              yield { type: "safety_override" };
              return;
            }
            yield { type: "content", content: pending.slice(0, len) };
            releasedInRound = upTo;
          }
        }

        // Accumulate tool call deltas
        const toolCallDeltas = choice.delta?.tool_calls;
        if (toolCallDeltas) {
          for (const tc of toolCallDeltas) {
            const existing = pendingToolCalls.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            } else {
              pendingToolCalls.set(tc.index, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              });
            }
          }
        }
      }
    } catch (error) {
      if (abortSignal?.aborted) {
        // A client disconnect or SSE timeout aborts the
        // OpenAI stream — the expected exit, not a failure. The interrupted-
        // message yield below is skipped: the caller breaks out of its own
        // loop on `isAborted()` before this event would ever reach the
        // client, and `contentInThisRound` is discarded with the early
        // return regardless.
        log.debug({ err: toError(error) }, "coach pro stream aborted");
        return;
      }
      log.error({ err: toError(error) }, "coach pro streaming error");
      yield {
        type: "content",
        content: "Sorry, the response was interrupted. Please try again.",
      };
      return;
    }

    // The rest of the round (an unfinished last sentence, the coach_blocks
    // fence) is vetted with the whole reply before it goes out.
    const rest = contentInThisRound.slice(releasedInRound);
    if (rest) {
      if (containsUnsafeCoachAdvice(fullResponse)) {
        yield { type: "safety_override" };
        return;
      }
      yield { type: "content", content: rest };
    }

    if (finishReason === "length") {
      log.warn({ toolCallCount }, "coach_pro_finish_reason_length");
    }

    // If finish_reason is not "tool_calls", we're done
    if (finishReason !== "tool_calls" || pendingToolCalls.size === 0) {
      break;
    }

    // offer_recipe is terminal: hand the first call's raw args to the caller
    // and stop. Other calls from this round are dropped, unexecuted.
    // Gated on offerTool: a model that hallucinates the call when it was not
    // offered falls through to executeToolCall like any unknown tool.
    const offerCall = offerTool
      ? Array.from(pendingToolCalls.values()).find(
          (tc) => tc.name === "offer_recipe",
        )
      : undefined;
    if (offerCall) {
      yield {
        type: "terminal_tool",
        name: "offer_recipe",
        args: offerCall.arguments,
      };
      return;
    }

    // Execute tool calls
    toolCallCount += pendingToolCalls.size;
    if (toolCallCount > MAX_TOOL_CALLS_PER_RESPONSE) {
      log.warn("Coach Pro: exceeded max tool calls per response");
      // Without this fallback, the response can end mid-thought when the
      // model was only emitting tool calls this round — the user sees a
      // truncated or empty reply. Yielding a short wrap-up keeps the
      // conversation coherent and signals why we stopped. (H6 — 2026-04-18)
      const truncationMsg =
        "\n\n*I've run out of tool-call budget for this response. Please ask a follow-up and I'll continue.*";
      fullResponse += truncationMsg;
      yield { type: "content", content: truncationMsg };
      break;
    }

    // Add assistant message with tool_calls to conversation
    const toolCallsArray = Array.from(pendingToolCalls.values()).map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    }));

    conversation.push({
      role: "assistant",
      content: contentInThisRound || null,
      tool_calls: toolCallsArray,
    });

    // Yield a tool_calls chunk immediately — before the tools run — so the
    // caller can surface a status event on the wire without waiting for the
    // next content chunk.
    yield {
      type: "tool_calls",
      toolNames: toolCallsArray.map((tc) => tc.function.name),
      calls: toolCallsArray.map((tc) => ({
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    };

    // Execute tool calls in parallel — preserve order when appending results
    const toolResults = await Promise.all(
      toolCallsArray.map(async (tc) => {
        // Parse JSON args explicitly so malformed/truncated argument strings
        // (e.g. when finish_reason === "length") are surfaced as their own
        // failure mode rather than falling through the generic outer catch
        // below. (M15 — 2026-05-11)
        let args: unknown;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch (error) {
          log.warn(
            {
              err: toError(error),
              tool: tc.function.name,
              argsLength: tc.function.arguments?.length,
            },
            "Tool call arguments JSON parse failed",
          );
          return {
            tc,
            result: serviceUnavailable(tc.function.name),
          };
        }
        // Per-tool Zod schemas inside executeToolCall validate fields, but
        // they assume the top-level value is an object. Reject primitives /
        // arrays explicitly so `as Record<string, unknown>` never lies. (M15)
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          log.warn(
            {
              tool: tc.function.name,
              argsType: Array.isArray(args)
                ? "array"
                : args === null
                  ? "null"
                  : typeof args,
            },
            "Tool call arguments not a plain object",
          );
          return {
            tc,
            result: serviceUnavailable(tc.function.name),
          };
        }
        try {
          const result = await executeToolCall(
            tc.function.name,
            args as Record<string, unknown>,
            userId,
            preloadedProfile,
            tz,
            // Only in write-card mode, so the call is unchanged without it.
            ...(options?.writeCards
              ? [
                  {
                    writeCards: true,
                    pantryCard: !!options.pantryCard,
                    goalsCard: !!options.goalsCard,
                    onWriteCardProposal: options.onWriteCardProposal,
                    planRecipePool: options.planRecipePool,
                  },
                ]
              : []),
          );
          return { tc, result };
        } catch (error) {
          log.warn(
            { err: toError(error), tool: tc.function.name },
            "Tool call failed",
          );
          return {
            tc,
            result: serviceUnavailable(tc.function.name),
          };
        }
      }),
    );

    for (const { tc, result } of toolResults) {
      conversation.push({
        role: "tool",
        content: JSON.stringify(result),
        tool_call_id: tc.id,
      });
    }

    // Loop continues — OpenAI will generate response using tool results
  }
}
