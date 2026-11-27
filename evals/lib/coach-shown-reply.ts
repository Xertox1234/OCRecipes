import {
  generateCoachResponse,
  generateCoachProResponse,
  SAFETY_OVERRIDE_SENTINEL,
  PROVIDER_FAILURE_SENTINEL,
} from "../../server/services/nutrition-coach";
import { matchesSelfHarm } from "../../server/services/coach-intent-classifier";
import {
  coachTurnIntents,
  flatRefusalReplacement,
  freeReplyShownText,
} from "../../server/services/coach-pro-chat/visible-reply";
import {
  SAFETY_CRISIS_FALLBACK_MESSAGE,
  SAFETY_REFUSAL_FALLBACK_MESSAGE,
  STANDARD_SAFETY_MESSAGE,
} from "../../server/lib/ai-safety";
import type { CoachContext } from "../../server/services/coach-prompt";
import {
  getBlocksSystemPrompt,
  parseBlocksFromContent,
} from "../../server/services/coach-blocks";
import { isRecipeFinderEnabled } from "../../server/services/recipe-finder/config";

export type CoachGenerator = typeof generateCoachResponse;

/**
 * The free-tier reply a user would see for one message: the same steps as
 * handleCoachChat and streamReply (crisis reply without a model call,
 * production intent, unsafe-stream override, shown-text cleanup, flat-refusal
 * swap). The eval scores this text, not the raw stream (audit 2026-11-24, M29).
 */
export async function coachShownReply(
  message: string,
  context: CoachContext,
  clock: { now: Date; tz: string },
  generate: CoachGenerator = generateCoachResponse,
): Promise<{ text: string; modelCalled: boolean }> {
  if (matchesSelfHarm(message)) {
    return { text: SAFETY_CRISIS_FALLBACK_MESSAGE, modelCalled: false };
  }
  const { prompt: intent } = coachTurnIntents(message);
  let raw = "";
  for await (const chunk of generate(
    [{ role: "user", content: message }],
    context,
    undefined,
    intent,
    clock.tz,
    clock.now,
  )) {
    // A failed provider call is not a reply to score: the sample errors, as
    // the chat turn does (audit 2026-11-24, M13).
    if (chunk === PROVIDER_FAILURE_SENTINEL) {
      throw new Error("Coach provider failed; no reply to score");
    }
    if (chunk === SAFETY_OVERRIDE_SENTINEL) {
      return { text: STANDARD_SAFETY_MESSAGE, modelCalled: true };
    }
    raw += chunk;
  }
  const shown = freeReplyShownText(raw);
  return {
    text: flatRefusalReplacement(message, shown, intent) ?? shown,
    modelCalled: true,
  };
}

const CANNED = new Set([
  STANDARD_SAFETY_MESSAGE,
  SAFETY_REFUSAL_FALLBACK_MESSAGE,
  SAFETY_CRISIS_FALLBACK_MESSAGE,
]);

/** True when the reply is one the server wrote, not the model. */
export function isCannedSafetyText(text: string): boolean {
  return CANNED.has(text);
}

export type CoachProGenerator = typeof generateCoachProResponse;

/** The app features a Coach Pro case turns on (what the client would send). */
export interface CoachProFlags {
  writeCards?: boolean;
  pantryCard?: boolean;
  goalsCard?: boolean;
  quickLog?: boolean;
  offer?: boolean;
  dayProgress?: boolean;
  weekProgress?: boolean;
}

/** What a read tool with no fixture returns: no data, never the database. */
export const NO_FIXTURE_RESULT = { found: false, message: "Nothing found." };

export interface CoachProTurn {
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  context: CoachContext;
  clock: { now: Date; tz: string };
  flags: CoachProFlags;
  /** Read-tool results by tool name. */
  fixtures: Record<string, unknown>;
}

export interface CoachProShownReply {
  text: string;
  modelCalled: boolean;
  blockTypes: string[];
  toolCalls: { name: string; args: unknown }[];
  /** Write cards the tools proposed, in order (the last one is shown). */
  proposals: { kind: string; args: unknown }[];
  offer?: unknown;
  safetyOverridden: boolean;
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * The Coach Pro reply a user would see for one turn (audit 2026-11-24, M30):
 * the same steps as streamProReply and finalizeTurn, with no database. The
 * blocks prompt is built from the case's flags as applyWriteCardContext does;
 * read tools answer from fixtures; write-card tools run their real code with
 * the card hand-off recorded. Then the unsafe-stream override, the
 * flat-refusal swap, and the text/blocks split.
 */
export async function coachProShownReply(
  turn: CoachProTurn,
  generate: CoachProGenerator = generateCoachProResponse,
): Promise<CoachProShownReply> {
  const { message, flags } = turn;
  const empty = { blockTypes: [], toolCalls: [], proposals: [] };
  if (matchesSelfHarm(message)) {
    return {
      ...empty,
      text: SAFETY_CRISIS_FALLBACK_MESSAGE,
      modelCalled: false,
      safetyOverridden: true,
    };
  }
  const { prompt: intent } = coachTurnIntents(message);
  const context: CoachContext = {
    ...turn.context,
    blocksPrompt: getBlocksSystemPrompt(isRecipeFinderEnabled(), {
      ...(flags.writeCards && { writeCards: true }),
      notesPaused: turn.context.notesPaused,
      ...(flags.quickLog && { quickLog: true }),
      ...(flags.dayProgress && { dayProgress: true }),
      ...(flags.weekProgress && { weekProgress: true }),
    }),
  };
  const toolCalls: CoachProShownReply["toolCalls"] = [];
  const proposals: CoachProShownReply["proposals"] = [];
  let offer: unknown;
  let raw = "";
  for await (const chunk of generate(
    [...turn.history, { role: "user", content: message }],
    context,
    "eval-user",
    undefined,
    null,
    intent,
    turn.clock.tz,
    {
      offerRecipe: !!flags.offer,
      now: turn.clock.now,
      readToolResult: (name) =>
        name in turn.fixtures ? turn.fixtures[name] : NO_FIXTURE_RESULT,
      ...(flags.writeCards && {
        writeCards: true,
        pantryCard: !!flags.pantryCard,
        // Not on a safety turn, as streamProReply does.
        goalsCard: !!flags.goalsCard && intent !== "safety_refusal",
        // Recorded, not built: the tool result is the default "card shown"
        // wording, which is what the model reads in production.
        onWriteCardProposal: async (p) => {
          proposals.push({ kind: p.kind, args: p.args });
        },
        planRecipePool: [],
      }),
    },
  )) {
    if (chunk.type === "provider_failure") {
      throw new Error("Coach provider failed; no reply to score");
    }
    if (chunk.type === "safety_override") {
      return {
        text: STANDARD_SAFETY_MESSAGE,
        modelCalled: true,
        blockTypes: [],
        toolCalls,
        proposals,
        safetyOverridden: true,
      };
    }
    if (chunk.type === "tool_calls") {
      for (const c of chunk.calls ?? []) {
        toolCalls.push({ name: c.name, args: parseArgs(c.arguments) });
      }
      continue;
    }
    if (chunk.type === "terminal_tool") {
      if (flags.offer) offer = parseArgs(chunk.args);
      break;
    }
    raw += chunk.content;
  }
  const replacement = flatRefusalReplacement(message, raw, intent);
  if (replacement) {
    return {
      text: replacement,
      modelCalled: true,
      blockTypes: [],
      toolCalls,
      proposals,
      safetyOverridden: true,
    };
  }
  const parsed = parseBlocksFromContent(raw);
  return {
    text: parsed.text,
    modelCalled: true,
    blockTypes: parsed.blocks.map((b) => b.type),
    toolCalls,
    proposals,
    ...(offer !== undefined && { offer }),
    safetyOverridden: false,
  };
}
