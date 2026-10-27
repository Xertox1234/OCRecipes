/**
 * Streaming half of POST /api/chat/conversations/:id/messages (extracted from
 * `chat.ts`, no behaviour change): SSE sink (write + byte cap + abort/timeout),
 * the recipe/remix and coach loops, and the coach-disconnect settle. Never
 * import `./chat` from here (circular-import rule, docs/rules/architecture.md).
 */
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { storage } from "../storage";
import type { AuthenticatedRequest } from "../middleware/auth";
import { checkPremiumFeature, parseTimezone } from "./_helpers";
import { fireAndForget } from "../lib/fire-and-forget";
import { SSE_TIMEOUT_MS } from "@shared/constants/sse";
import {
  generateRecipeChatResponse,
  buildRecipeContext,
  buildRemixSystemPrompt,
  type RecipeChatRecipe,
} from "../services/recipe-chat";
import { remixConversationMetadataSchema } from "@shared/schemas/recipe-chat";
import { logger, toError } from "../lib/logger";
import {
  handleCoachChat,
  STANDARD_SAFETY_MESSAGE,
} from "../services/coach-pro-chat";
import {
  sanitizeContextField,
  containsUnsafeCoachAdvice,
} from "../lib/ai-safety";
import { parseBlocksFromContent } from "../services/coach-blocks";
import type { ChatConversation, ChatMessage } from "@shared/schema";
import type { finderActionSchema } from "@shared/schemas/recipe-finder";
import type { z } from "zod";
import {
  prepareFinderTurn,
  executeFinderStep,
  finderStatusLabel,
  type FinderInput,
  type GenerationMessages,
} from "../services/recipe-finder";

const SSE_MAX_RESPONSE_BYTES = 50 * 1024; // 50KB max response size

export type ConversationType = "coach" | "recipe" | "remix";
export type TurnFeatures = NonNullable<
  Awaited<ReturnType<typeof checkPremiumFeature>>
>;
type TurnUser = NonNullable<Awaited<ReturnType<typeof storage.getUser>>>;

/** Everything the route resolved before the stream opens. */
export interface TurnInput {
  req: AuthenticatedRequest;
  res: Response;
  conversationId: number;
  conversation: ChatConversation;
  conversationType: ConversationType;
  features: TurnFeatures;
  user: TurnUser;
  sanitizedContent: string;
  body: { screenContext?: string; warmUpId?: string; turnKey?: string };
  userMessage: ChatMessage;
  finderEnabled: boolean;
  offerEnabled: boolean;
  finderAction: z.infer<typeof finderActionSchema> | undefined;
  finderHistory: ChatMessage[];
  recipeFinderInput: FinderInput | null;
}

/** Per-turn mutable state; read `aborted` through it, never copy (coach polls it). */
export interface TurnState {
  aborted: boolean;
  clientDisconnected: boolean;
  responseBytes: number;
  /** Coach path: the content actually delivered to the client. */
  streamedContent: string;
}

interface TurnContext extends TurnInput {
  state: TurnState;
  sink: SseSink;
  abortController: AbortController;
  /** Lets the settle phase tell whether the service already saved the reply. */
  coachTurnKey: string;
}

/** What differs per conversation type — the single dispatch table. */
export const CONVERSATION_CONFIG: Record<
  ConversationType,
  {
    featureKey: "recipeGeneration" | "aiCoach";
    featureLabel: string;
    dailyLimit: (f: TurnFeatures) => number;
    limitMessage: (f: TurnFeatures) => string;
    stream: (ctx: TurnContext) => Promise<void>;
  }
> = {
  coach: {
    featureKey: "aiCoach",
    featureLabel: "AI Coach",
    dailyLimit: (f) =>
      f.coachPro ? f.coachProDailyMessages : f.dailyCoachMessages,
    limitMessage: (f) =>
      f.coachPro
        ? "Daily Coach Pro message limit reached"
        : "Daily chat message limit reached",
    stream: streamCoachTurn,
  },
  recipe: {
    featureKey: "recipeGeneration",
    featureLabel: "Recipe Generation",
    dailyLimit: (f) => f.dailyRecipeGenerations,
    limitMessage: () => "Daily recipe generation limit reached",
    stream: streamRecipeTurn,
  },
  remix: {
    featureKey: "recipeGeneration",
    featureLabel: "Recipe Remix",
    dailyLimit: (f) => f.dailyRecipeGenerations,
    limitMessage: () => "Daily recipe generation limit reached",
    stream: streamRecipeTurn,
  },
};

/** Owns SSE writes, the response byte cap, and the abort/timeout wiring. */
class SseSink {
  private readonly timeout: ReturnType<typeof setTimeout>;

  constructor(
    private readonly res: Response,
    private readonly conversationId: number,
    private readonly state: TurnState,
    private readonly abortController: AbortController,
  ) {
    // SSE timeout — prevent hung connections
    this.timeout = setTimeout(() => {
      state.aborted = true;
      abortController.abort();
      // The coach generators' "streaming error" log is downgraded to debug
      // on any abort (disconnect and timeout share the signal — see
      // nutrition-coach.ts), so a genuine hang would vanish above debug.
      // Log it here, where the SSE-timeout cause is unambiguous.
      logger.warn({ conversationId }, "chat SSE stream timed out");
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: "Response timeout" })}\n\n`);
        res.end();
      }
    }, SSE_TIMEOUT_MS);
  }

  /** Write one SSE event from an already-serialised JSON payload. */
  sendRaw(json: string): void {
    this.res.write(`data: ${json}\n\n`);
  }

  send(payload: unknown): void {
    this.sendRaw(JSON.stringify(payload));
  }

  /** Write only while the response is still open. */
  sendIfOpen(payload: unknown): void {
    if (!this.res.writableEnded) this.send(payload);
  }

  /**
   * Count an event against the response size cap. Returns true when the cap
   * tripped (the caller must stop streaming) — the abort, log and error event
   * are already done.
   */
  exceedsCap(eventJson: string): boolean {
    this.state.responseBytes += eventJson.length;
    if (this.state.responseBytes <= SSE_MAX_RESPONSE_BYTES) return false;
    this.state.aborted = true;
    this.abortController.abort();
    // Closes the generator via return(), not a catch: log it here.
    logger.warn(
      {
        conversationId: this.conversationId,
        responseBytes: this.state.responseBytes,
      },
      "chat SSE response exceeded the size limit",
    );
    this.sendIfOpen({ error: "Response too large" });
    return true;
  }

  dispose(): void {
    clearTimeout(this.timeout);
  }
}

/**
 * Open the SSE stream and run the turn: stream via the type's loop, report
 * errors, settle a coach disconnect, end the response.
 */
export async function runTurn(input: TurnInput): Promise<void> {
  const { res, conversationId: id } = input;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Client disconnect aborts the OpenAI stream via this controller (M8).
  // Listen on `res`, not `req`: express.json() already consumed the body, so
  // the request's "close" fired before this line. `!res.writableFinished`
  // separates a dropped client from our own res.end(). Coach path only: a
  // recipe/remix partial is half a JSON recipe, so that path keeps finishing
  // and saving after a disconnect rather than burning quota for nothing.
  const isCoachPath = input.conversationType === "coach";
  const abortController = new AbortController();
  const state: TurnState = {
    aborted: false,
    clientDisconnected: false,
    responseBytes: 0,
    streamedContent: "",
  };
  res.on("close", () => {
    if (res.writableFinished || !isCoachPath) return;
    state.clientDisconnected = true;
    state.aborted = true;
    abortController.abort();
  });

  const sink = new SseSink(res, id, state, abortController);
  const ctx: TurnContext = {
    ...input,
    state,
    sink,
    abortController,
    coachTurnKey: input.body.turnKey ?? randomUUID(),
  };

  try {
    await CONVERSATION_CONFIG[input.conversationType].stream(ctx);

    if (!state.aborted) {
      sink.send({ done: true });
    }
  } catch (error) {
    // A client disconnect aborts the OpenAI stream, which throws —
    // the expected exit, so log it at debug rather than error.
    if (state.clientDisconnected) {
      logger.debug(
        { err: toError(error) },
        "chat stream ended by client disconnect",
      );
    } else {
      logger.error({ err: toError(error) }, "chat streaming error");
    }
    if (!state.aborted)
      sink.sendIfOpen({ error: "Failed to generate response" });
  } finally {
    sink.dispose();
  }

  await settleAbortedCoachTurn(ctx);
  res.end();
}

async function streamRecipeTurn(ctx: TurnContext): Promise<void> {
  const {
    req,
    conversation,
    conversationId: id,
    conversationType,
    features,
    sanitizedContent,
    userMessage,
    offerEnabled,
    finderHistory,
    recipeFinderInput,
    state,
    sink,
  } = ctx;
  const isRemixChat = conversationType === "remix";

  // ─── RECIPE FINDER STEP (RecipeChef, flag on) ────────
  let finderGeneration: GenerationMessages | null = null;
  let finderAllergenDetail: "extended" | undefined;
  if (recipeFinderInput) {
    const finderProfile = await storage.getUserProfile(req.userId);
    const { step, latest } = prepareFinderTurn(
      finderHistory,
      recipeFinderInput,
      { offer: offerEnabled },
    );
    const label = finderStatusLabel(step);
    if (label) {
      sink.send({ status: label });
    }
    const turn = await executeFinderStep(step, {
      userId: req.userId,
      userMessageId: userMessage.id,
      history: finderHistory,
      profile: finderProfile,
      features,
      offer: offerEnabled,
      latest,
    });
    const autoTitle = () => {
      if (!finderHistory.some((m) => m.role === "user")) {
        fireAndForget(
          "recipe-finder-auto-title",
          storage.updateChatConversationTitle(
            id,
            req.userId,
            sanitizedContent.slice(0, 50),
          ),
        );
      }
    };
    if (turn.kind === "close" || turn.kind === "plain") {
      // Plain reply, no block: the user row stays and the turn is
      // answered. Streamed as content, like a normal chat reply.
      await storage.createChatMessage(
        id,
        req.userId,
        "assistant",
        turn.content,
      );
      sink.sendIfOpen({ content: turn.content });
      autoTitle();
    } else if (turn.kind === "message") {
      await storage.createChatMessage(
        id,
        req.userId,
        "assistant",
        turn.content,
        { metadataVersion: 1, finder: turn.block },
      );
      sink.sendIfOpen(
        // Only the offer carries its question text: the client
        // shows it in the pending bubble before the refetch.
        // Every other block's event stays {finder} alone.
        turn.block.type === "recipe_offer"
          ? { finder: turn.block, content: turn.content }
          : { finder: turn.block },
      );
      autoTitle();
    } else if (turn.kind === "ignored") {
      // e.g. Find ideas on an inspired-ideas list — nothing to
      // answer, so don't leave a dangling user bubble.
      await storage.deleteChatMessage(userMessage.id, req.userId);
    } else if (turn.kind === "generate") {
      finderGeneration = turn.messages;
      finderAllergenDetail = turn.allergenDetail;
      // A round-1 search that found nothing falls through to
      // Generate: update the thinking bubble.
      if (step.kind !== "generate") {
        sink.send({ status: "Creating your recipe…" });
      }
    }
  }

  if (recipeFinderInput && !finderGeneration) return;

  const remixSourceId = isRemixChat
    ? remixConversationMetadataSchema.safeParse(conversation.metadata)?.data
        ?.sourceRecipeId
    : undefined;

  const [profile, history, sourceRecipe] = await Promise.all([
    storage.getUserProfile(req.userId),
    storage.getChatMessages(id, 10, req.userId),
    remixSourceId
      ? storage.getCommunityRecipe(remixSourceId, req.userId)
      : undefined,
  ]);

  // A finder Generate sends only the refined request (spec §3.1).
  const contextMessages = finderGeneration ?? buildRecipeContext(history);

  // For remix, build a specialized system prompt with the original recipe
  let remixPromptOverride: string | undefined;
  if (isRemixChat && sourceRecipe) {
    remixPromptOverride = buildRemixSystemPrompt(
      {
        title: sourceRecipe.title,
        ingredients: sourceRecipe.ingredients ?? [],
        instructions: sourceRecipe.instructions,
        dietTags: sourceRecipe.dietTags ?? [],
        description: sourceRecipe.description,
        difficulty: sourceRecipe.difficulty,
        timeEstimate: sourceRecipe.timeEstimate,
        servings: sourceRecipe.servings,
      },
      profile,
    );
  }

  let fullTextResponse = "";
  let recipeData: RecipeChatRecipe | null = null;
  let allergenWarning: string | null = null;
  let recipeImageUrl: string | null = null;

  const sanitizedScreenContext = ctx.body.screenContext
    ? sanitizeContextField(ctx.body.screenContext, 200)
    : undefined;

  for await (const event of generateRecipeChatResponse(
    contextMessages,
    profile,
    sanitizedScreenContext,
    remixPromptOverride || finderAllergenDetail
      ? {
          ...(remixPromptOverride
            ? { systemPromptOverride: remixPromptOverride }
            : {}),
          ...(finderAllergenDetail
            ? { allergenDetail: finderAllergenDetail }
            : {}),
        }
      : undefined,
  )) {
    // `aborted` flips here only via the byte cap or the SSE timeout — a
    // client disconnect never sets it on this path.
    if (state.aborted) break;

    const eventJson = JSON.stringify(event);
    if (sink.exceedsCap(eventJson)) break;

    if ("done" in event && event.done) {
      // Terminal event — handled after loop
    } else if ("recipe" in event && event.recipe) {
      recipeData = event.recipe;
      allergenWarning = event.allergenWarning;
      sink.sendRaw(eventJson);
    } else if ("imageUrl" in event && event.imageUrl) {
      recipeImageUrl = event.imageUrl;
      sink.sendRaw(eventJson);
    } else if ("imageUnavailable" in event && event.imageUnavailable) {
      sink.sendRaw(eventJson);
    } else if ("content" in event && event.content) {
      fullTextResponse += event.content;
      sink.sendRaw(eventJson);
    }
  }

  // Save the assistant message with the recipe in metadata. A disconnect
  // does not skip this (recipe/remix finish-and-save policy, P2-2026-09-24).
  if (!state.aborted && (fullTextResponse || recipeData)) {
    const metadata = recipeData
      ? {
          metadataVersion: 1,
          recipe: recipeData,
          allergenWarning,
          imageUrl: recipeImageUrl,
        }
      : null;

    // Strip the JSON code block — recipe is in metadata; only save conversational text
    const conversationalText = fullTextResponse
      .replace(/\n*```json[\s\S]*?```\s*/g, "")
      .trim();

    await storage.createChatMessage(
      id,
      req.userId,
      "assistant",
      conversationalText || "Here's a recipe for you!",
      metadata,
    );
  }

  // Auto-title from the recipe name on the first exchange (fire-and-forget);
  // history.length is the count before this exchange. Same `aborted`
  // semantics as the persistence gate above.
  if (!state.aborted && recipeData && history.length <= 1) {
    fireAndForget(
      "recipe-chat-auto-title",
      storage.updateChatConversationTitle(id, req.userId, recipeData.title),
    );
  }
}

async function streamCoachTurn(ctx: TurnContext): Promise<void> {
  const {
    req,
    conversationId: id,
    features,
    user,
    sanitizedContent,
    userMessage,
    finderEnabled,
    finderAction,
    state,
    sink,
    abortController,
    coachTurnKey,
  } = ctx;

  for await (const event of handleCoachChat({
    conversationId: id,
    userId: req.userId,
    content: sanitizedContent,
    screenContext: ctx.body.screenContext,
    warmUpId: ctx.body.warmUpId,
    turnKey: coachTurnKey,
    isCoachPro: !!features.coachPro,
    user: {
      dailyCalorieGoal: user.dailyCalorieGoal,
      dailyProteinGoal: user.dailyProteinGoal,
      dailyCarbsGoal: user.dailyCarbsGoal,
      dailyFatGoal: user.dailyFatGoal,
      weight: user.weight,
      goalWeight: user.goalWeight,
      measurementUnit: user.measurementUnit,
    },
    tz: parseTimezone(req.headers["x-timezone"]),
    isAborted: () => state.aborted,
    abortSignal: abortController.signal,
    finder:
      finderEnabled && features.coachPro
        ? {
            action: finderAction,
            userMessageId: userMessage.id,
            features: {
              catalogSave: features.catalogSave,
              recipeGeneration: features.recipeGeneration,
              dailyRecipeGenerations: features.dailyRecipeGenerations,
            },
          }
        : undefined,
  })) {
    if (state.aborted) break;
    const eventJson = JSON.stringify(
      event.type === "content"
        ? { content: event.content }
        : event.type === "status"
          ? { status: event.label }
          : event.type === "safety_override"
            ? { safety_override: event.message }
            : { blocks: event.blocks },
    );
    if (sink.exceedsCap(eventJson)) break;
    if (event.type === "content") state.streamedContent += event.content;
    // The override replaces what the client shows, as it does the service's
    // own fullResponse. Defensive: a delivered override must never count as
    // "nothing streamed" (refund) if a close ever lands before the save.
    else if (event.type === "safety_override")
      state.streamedContent = event.message;
    sink.sendRaw(eventJson);
  }
}

/**
 * H6 — the client left mid-answer. The user message is already quota-counted,
 * so refund it (nothing streamed) or keep what they paid for as the assistant
 * reply (something streamed) — refunding delivered content would let a client
 * read an answer and abort just before `done` to get the message free.
 */
async function settleAbortedCoachTurn(ctx: TurnContext): Promise<void> {
  const { req, conversationId: id, features, userMessage, coachTurnKey } = ctx;
  const { streamedContent } = ctx.state;
  if (!ctx.state.clientDisconnected) return;
  try {
    // Skip if the service's own write landed before the close did.
    const alreadyPersisted = await storage.getChatMessageByTurnKey(
      id,
      coachTurnKey,
    );
    if (alreadyPersisted) return;
    const parsedPartial = features.coachPro
      ? parseBlocksFromContent(streamedContent)
      : { text: streamedContent.trim(), blocks: [] };
    // An unterminated fence is half-written block JSON — the client
    // hid it while streaming, so it was never "delivered".
    const strippedText = parsedPartial.text
      .replace(/```coach_blocks[\s\S]*$/, "")
      .trim();
    // Free-tier deltas stream BEFORE the service's end-of-response
    // safety check, so a partial cut mid-stream was never vetted.
    const partialText = containsUnsafeCoachAdvice(strippedText)
      ? STANDARD_SAFETY_MESSAGE
      : strippedText;
    const { blocks } = parsedPartial;
    if (!partialText && blocks.length === 0) {
      // Paid recipe-finder claims live in recipe_finder_claims, so
      // this refund can never hand a paid slot back (#1151).
      await storage.deleteChatMessage(userMessage.id, req.userId);
    } else {
      // Never cached, titled, or notebook-extracted — a partial.
      await storage.createChatMessage(
        id,
        req.userId,
        "assistant",
        partialText,
        blocks.length > 0 ? { blocks } : null,
        coachTurnKey,
      );
    }
  } catch (error) {
    logger.error(
      { err: toError(error) },
      "failed to settle aborted coach turn",
    );
  }
}
