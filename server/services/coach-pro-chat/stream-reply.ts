import {
  generateCoachResponse,
  generateCoachProResponse,
  SAFETY_OVERRIDE_SENTINEL,
} from "../nutrition-coach";
import {
  matchesDisorderedEating,
  matchesSelfHarm,
  type CoachIntent,
} from "../coach-intent-classifier";
import { plainStatusLabel, toolStep } from "../coach-step-labels";
import {
  STANDARD_SAFETY_MESSAGE,
  SAFETY_REFUSAL_FALLBACK_MESSAGE,
  SAFETY_CRISIS_FALLBACK_MESSAGE,
  isFlatModelRefusal,
} from "../../lib/ai-safety";
import {
  pantryRowLine,
  planGroceryCard,
  planPantryCard,
  type WriteCardOutcome,
  type WriteCardProposal,
} from "../write-cards";
import type { WriteCardPayload } from "@shared/schemas/coach-write-cards";
import { createServiceLogger, toError } from "../../lib/logger";
import type { TurnContext } from "./load-turn-context";
import type { CoachChatEvent, CoachChatParams } from "./types";

const log = createServiceLogger("coach-pro-chat");

/** What the reply stage hands to finalize — plain data. */
export interface ReplyResult {
  fullResponse: string;
  safetyOverridden: boolean;
  /** Raw `offer_recipe` args when the model ended the turn with the offer. */
  offerToolArgs: string | null;
  writeCardProposal: WriteCardProposal | null;
  /** The grocery/pantry card's payload, worked out during its tool call. */
  writeCardPrepared: WriteCardPayload | null;
  /** Show-the-work: what this turn looked up, for the "Checked:" trail. */
  trailEntries: (string | null)[];
}

interface StreamArgs {
  params: CoachChatParams;
  turn: TurnContext;
  intent: CoachIntent;
  offerOn: boolean;
  writeCards: boolean;
  pantryCard: boolean;
}

function emptyReply(): ReplyResult {
  return {
    fullResponse: "",
    safetyOverridden: false,
    offerToolArgs: null,
    writeCardProposal: null,
    writeCardPrepared: null,
    trailEntries: [],
  };
}

/** Sends a cached free-tier reply in 3 chunks with minimal delay. */
async function* replayCached(
  cachedResponse: string,
  isAborted: () => boolean,
): AsyncGenerator<CoachChatEvent, ReplyResult> {
  const reply = emptyReply();
  const len = cachedResponse.length;
  const third = Math.ceil(len / 3);
  const chunks = [
    cachedResponse.slice(0, third),
    cachedResponse.slice(third, third * 2),
    cachedResponse.slice(third * 2),
  ].filter((c) => c.length > 0);
  for (let ci = 0; ci < chunks.length && !isAborted(); ci++) {
    reply.fullResponse += chunks[ci];
    yield { type: "content", content: chunks[ci] };
    if (ci < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  return reply;
}

async function* streamProReply(
  a: StreamArgs,
): AsyncGenerator<CoachChatEvent, ReplyResult> {
  const { params, turn, intent, offerOn, writeCards, pantryCard } = a;
  const { userId, isAborted, abortSignal } = params;
  const reply = emptyReply();

  for await (const chunk of generateCoachProResponse(
    turn.messageHistory,
    turn.context,
    userId,
    abortSignal,
    turn.profile,
    // Reuse the intent classified once at the top of the turn — skips a
    // redundant classifyIntent call inside the generator.
    intent,
    turn.tz,
    {
      offerRecipe: offerOn,
      // Only in write-card mode, so the options are unchanged without it.
      ...(writeCards && {
        writeCards: true,
        // A turn shows at most one card: the last write tool call wins.
        onWriteCardProposal: async (
          p: WriteCardProposal,
        ): Promise<void | WriteCardOutcome> => {
          if (p.kind !== "grocery" && p.kind !== "pantry") {
            reply.writeCardProposal = p;
            reply.writeCardPrepared = null;
            return;
          }
          // These two are worked out now, so the tool result can say what
          // the card shows. With no card to show, an earlier proposal from
          // this turn stays.
          try {
            if (p.kind === "pantry") {
              const plan = await planPantryCard(p.args, userId);
              if (!plan.payload) {
                return {
                  kind: "pantry",
                  shown: false,
                  rows: [],
                  dropped: plan.dropped,
                };
              }
              reply.writeCardProposal = p;
              reply.writeCardPrepared = plan.payload;
              return {
                kind: "pantry",
                shown: true,
                rows: plan.payload.rows.map(pantryRowLine),
                dropped: plan.dropped,
              };
            }
            const plan = await planGroceryCard(p.args, userId);
            if (!plan.payload) {
              return { kind: "grocery", shown: false, leftOff: plan.leftOff };
            }
            reply.writeCardProposal = p;
            reply.writeCardPrepared = plan.payload;
            return {
              kind: "grocery",
              shown: true,
              leftOff: plan.leftOff,
              unticked: plan.unticked,
            };
          } catch (err) {
            // Build it at the end of the turn instead, as before.
            log.warn(
              { err: toError(err), kind: p.kind },
              "coach write card not planned",
            );
            reply.writeCardProposal = p;
            reply.writeCardPrepared = null;
          }
        },
        planRecipePool: [],
        // Only when the app can draw the pantry card and the plan has the
        // pantry: otherwise the model never gets update_pantry.
        ...(pantryCard && { pantryCard: true }),
      }),
    },
  )) {
    // A later sentence failed the unsafe-advice check: replace everything
    // shown and save only the safety message (as the free tier does).
    if (chunk.type === "safety_override") {
      reply.fullResponse = STANDARD_SAFETY_MESSAGE;
      reply.safetyOverridden = true;
      if (!isAborted())
        yield { type: "safety_override", message: STANDARD_SAFETY_MESSAGE };
      break;
    }
    if (chunk.type === "tool_calls") {
      // Yielded immediately when the tools are detected, before they run —
      // surface the status event on the wire now instead of waiting for
      // the next content chunk.
      const calls =
        chunk.calls ??
        chunk.toolNames.map((name) => ({ name, arguments: "{}" }));
      for (const call of calls) {
        if (isAborted()) break;
        const step = toolStep(call, { writeCards });
        reply.trailEntries.push(step.trail);
        // step first: a new client queues it and then ignores the plain
        // status, so the line never flickers between the two labels.
        yield { type: "step", label: step.label };
        yield { type: "status", label: plainStatusLabel(call.name) };
      }
      if (isAborted()) break;
      continue;
    }
    // offer_recipe ends the generator; it is handled after the loop. A
    // client that already left gets nothing saved (as for plain text).
    if (chunk.type === "terminal_tool") {
      if (offerOn && !isAborted()) reply.offerToolArgs = chunk.args;
      break;
    }
    if (isAborted()) break;
    reply.fullResponse += chunk.content;
    yield { type: "content", content: chunk.content };
  }
  return reply;
}

async function* streamFreeReply(
  a: StreamArgs,
): AsyncGenerator<CoachChatEvent, ReplyResult> {
  const { params, turn, intent } = a;
  const reply = emptyReply();
  for await (const chunk of generateCoachResponse(
    turn.messageHistory,
    turn.context,
    params.abortSignal,
    // Reuse the intent classified once at the top of the turn — skips a
    // redundant classifyIntent call inside the generator.
    intent,
    turn.tz,
  )) {
    if (params.isAborted()) break;
    if (chunk === SAFETY_OVERRIDE_SENTINEL) {
      reply.fullResponse = STANDARD_SAFETY_MESSAGE;
      yield { type: "safety_override", message: STANDARD_SAFETY_MESSAGE };
      break;
    }
    reply.fullResponse += chunk;
    yield { type: "content", content: chunk };
  }
  return reply;
}

/**
 * Streams the reply: the cached replay, else the tier's generator. Ends with
 * the safety re-scan, so it runs after the stream and before any persistence.
 */
export async function* streamReply(
  a: StreamArgs,
): AsyncGenerator<CoachChatEvent, ReplyResult> {
  const { params, turn, intent } = a;
  const { content, isCoachPro, isAborted } = params;

  const reply = turn.cachedResponse
    ? yield* replayCached(turn.cachedResponse, isAborted)
    : isCoachPro
      ? yield* streamProReply(a)
      : yield* streamFreeReply(a);

  // The model itself sometimes answers a safety-sensitive turn (distress,
  // disordered eating) with only a bare refusal. Replace it like an unsafe
  // reply: the client swaps what it showed, and the supportive text is saved.
  if (
    !reply.safetyOverridden &&
    intent === "safety_refusal" &&
    !isAborted() &&
    isFlatModelRefusal(reply.fullResponse)
  ) {
    // Suicide or self-harm comes first, and gets the crisis message even when
    // the same message also mentions purging. The warm fallback is worded for
    // distress about eating; other safety turns (medical, injection, ...) get
    // the generic referral message.
    const replacement = matchesSelfHarm(content)
      ? SAFETY_CRISIS_FALLBACK_MESSAGE
      : matchesDisorderedEating(content)
        ? SAFETY_REFUSAL_FALLBACK_MESSAGE
        : STANDARD_SAFETY_MESSAGE;
    reply.fullResponse = replacement;
    reply.safetyOverridden = true;
    yield { type: "safety_override", message: replacement };
  }
  return reply;
}
