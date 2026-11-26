import type { CoachIntent } from "../coach-intent-classifier";
import { EmptyCoachReplyError } from "./empty-reply";
import { storage } from "../../storage";
import { fireAndForget } from "../../lib/fire-and-forget";
import { filterMemoryRefs } from "../memory-refs";
import { filterAllergyCards } from "../allergy-cards";
import { dropCommitmentCards, parseBlocksFromContent } from "../coach-blocks";
import { buildTrail } from "../coach-step-labels";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import {
  createWriteCardBlock,
  withdrawFoodLoggedAtOnce,
} from "./write-card-context";
import { deliverOfferToolCall, persistCoachReply } from "./offer-delivery";
import { extractAndStoreNotebook } from "./notebook";
import type { TurnContext } from "./load-turn-context";
import type { ReplyResult } from "./stream-reply";
import type { CoachChatEvent, CoachChatParams } from "./types";

interface ReplyBlocks {
  textContent: string;
  blocks: CoachBlock[];
  wroteCard: boolean;
}

/** The free tier's reply is plain text: no blocks, no card, no trail. */
function freeReplyBlocks(reply: ReplyResult): ReplyBlocks {
  return { textContent: reply.fullResponse, blocks: [], wroteCard: false };
}

/** Coach Pro: parse blocks, build the write card, lead with the trail. */
async function proReplyBlocks(
  params: CoachChatParams,
  turn: TurnContext,
  reply: ReplyResult,
): Promise<ReplyBlocks> {
  const { conversationId, userId, isAborted } = params;
  const { fullResponse } = reply;
  let blocks: CoachBlock[] = [];
  let textContent = fullResponse;
  if (fullResponse) {
    const parsedBlocks = parseBlocksFromContent(fullResponse);
    textContent = parsedBlocks.text;
    // R1: a reply may cite only confirmed entries the prompt was given.
    const confirmedIds = new Set(
      turn.notebookEntries
        .filter(
          (e) =>
            e.status === "active" &&
            e.confirmedAt != null &&
            (e.type === "goal" ||
              e.type === "preference" ||
              e.type === "commitment"),
        )
        .map((e) => e.id),
    );
    blocks = filterAllergyCards(
      filterMemoryRefs(parsedBlocks.blocks, confirmedIds),
      turn.context.dietaryProfile.allergies.map((a) => a.name),
    );
    // Coach's notes are paused: accepting a commitment card would save
    // nothing, so a card the model wrote anyway never reaches the screen.
    if (turn.context.notesPaused) blocks = dropCommitmentCards(blocks);
  }

  // The write card is built (and its row created) only for a client still
  // here: the row locks the previous live card, which an abandoned turn must
  // not do. A reply the safety check replaced carries no card either: the
  // card would sit under the safety message, offering what it withdrew.
  let wroteCard = false;
  // Coach roadmap T2: a food logged at once during the turn leads its cards.
  // A reply that will never show it (the client left, the safety message
  // replaced it, it came back empty) has it withdrawn instead.
  if (reply.loggedAtOnce) {
    if (fullResponse && !reply.safetyOverridden && !isAborted()) {
      blocks = [...blocks, reply.loggedAtOnce];
      wroteCard = true;
    } else {
      await withdrawFoodLoggedAtOnce(reply.loggedAtOnce, userId);
    }
  }
  if (
    reply.writeCardProposal &&
    fullResponse &&
    !reply.safetyOverridden &&
    !isAborted()
  ) {
    const card = await createWriteCardBlock(
      reply.writeCardProposal,
      { conversationId, userId, tz: turn.tz, isAborted },
      reply.writeCardPrepared,
    );
    if (card) {
      blocks = [...blocks, card];
      wroteCard = true;
    }
  }

  // The allergy card (Coach roadmap T1) has no tool: for an app that can draw
  // it, the Coach's "Add X to your allergies" action card becomes a card the
  // user saves in the chat. The action card stays when the turn already has
  // a card (a conversation holds one live card) or none can be built (no
  // health-data consent on record: the profile screen asks for it).
  const allergyAt = blocks.findIndex(
    (b) => b.type === "action_card" && b.action.type === "add_allergy",
  );
  const allergyBlock = blocks[allergyAt];
  if (
    params.allergyCard &&
    params.writeCards &&
    params.isCoachPro &&
    !reply.writeCardProposal &&
    !reply.safetyOverridden &&
    !isAborted() &&
    allergyBlock?.type === "action_card" &&
    allergyBlock.action.type === "add_allergy"
  ) {
    const card = await createWriteCardBlock(
      { kind: "allergy", args: { allergen: allergyBlock.action.allergen } },
      { conversationId, userId, tz: turn.tz, isAborted },
    );
    if (card) {
      blocks = [...blocks.filter((_, i) => i !== allergyAt), card];
      wroteCard = true;
    }
  }

  // The trail leads the reply's blocks, so it sits right under the text and
  // above any card. A safety override replaced the reply: no trail for it.
  const trail = buildTrail(reply.trailEntries);
  if (!reply.safetyOverridden && trail.length > 0) {
    blocks = [{ type: "checked_trail", items: trail }, ...blocks];
  }
  return { textContent, blocks, wroteCard };
}

/**
 * Everything after the stream: blocks, the offer tool call, persistence, the
 * cache write, auto-title, the final blocks event and notebook extraction.
 */
export async function* finalizeTurn(
  params: CoachChatParams,
  turn: TurnContext,
  reply: ReplyResult,
  intent: CoachIntent,
): AsyncGenerator<CoachChatEvent> {
  const { conversationId, userId, content, turnKey, isCoachPro, isAborted } =
    params;
  const { fullResponse } = reply;

  const { textContent, blocks, wroteCard } = isCoachPro
    ? await proReplyBlocks(params, turn, reply)
    : freeReplyBlocks(reply);

  const maybeAutoTitle = () => {
    if (!isAborted() && turn.turnCount <= 1) {
      const shortTitle =
        content.slice(0, 50) + (content.length > 50 ? "..." : "");
      fireAndForget(
        "coach-chat-auto-title",
        storage.updateChatConversationTitle(conversationId, userId, shortTitle),
      );
    }
  };

  // ── offer_recipe (offer flag on) — save BEFORE yield, then return ──
  if (reply.offerToolArgs !== null && params.finder) {
    const handled = yield* deliverOfferToolCall({
      params,
      finder: params.finder,
      rawArgs: reply.offerToolArgs,
      history: turn.history,
      leadText: textContent.trim(),
      leadBlocks: blocks,
      maybeAutoTitle,
    });
    if (handled) return;
  }

  // Nothing a user can see came back. A client that already left is settled
  // by the route's disconnect path instead.
  if (!isAborted() && !textContent.trim() && blocks.length === 0) {
    throw new EmptyCoachReplyError();
  }

  if (fullResponse && !isAborted()) {
    await persistCoachReply(
      conversationId,
      userId,
      turnKey,
      textContent,
      blocks.length > 0 ? { blocks } : null,
    );
  }

  // Cache write after DB write (ordering fix: cache should only exist for persisted messages)
  if (turn.questionHash && fullResponse && !isAborted()) {
    fireAndForget(
      "coach-cache-response",
      storage.setCoachCachedResponse(
        userId,
        turn.questionHash,
        content,
        fullResponse,
      ),
    );
  }

  maybeAutoTitle();

  // Send blocks in the final event for Coach Pro
  if (!isAborted() && blocks.length > 0) {
    yield { type: "blocks", blocks };
  }

  // Fire-and-forget notebook extraction + archival for Coach Pro. On a turn
  // the safety router refused or the safety screen replaced, only the mood
  // nudge is taken: what the user asked for there ("my goal is 800 calories
  // a day") must not be saved as a goal and handed back to Coach later.
  if (isCoachPro && fullResponse && !isAborted()) {
    fireAndForget(
      "coach-notebook-extraction",
      extractAndStoreNotebook({
        messageHistory: turn.messageHistory,
        content,
        textContent,
        userId,
        conversationId,
        today: turn.today,
        tz: turn.tz,
        wroteCard,
        moodOnly: intent === "safety_refusal" || reply.safetyOverridden,
      }),
    );
  }
}
