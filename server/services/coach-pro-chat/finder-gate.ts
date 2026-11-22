import { storage } from "../../storage";
import type { CoachIntent } from "../coach-intent-classifier";
import { classifyTurn, decideCoachFinderEntry } from "../recipe-finder";
import type { CoachFinderTurnEntry } from "../recipe-finder/coach-turn";
import type { ChatMessage } from "@shared/schema";
import type { CoachChatParams } from "./types";

/**
 * The recipe finder's gate (Coach Pro, flag on). Returns the history it read
 * (reused by the tool-loop path: one read per turn — perf audit M5) and the
 * finder entry when this turn belongs to the finder; null entry → tool loop.
 */
export async function resolveFinderEntry(
  params: CoachChatParams,
  classifiedIntent: CoachIntent,
  offerOn: boolean,
): Promise<{ history?: ChatMessage[]; entry: CoachFinderTurnEntry | null }> {
  const { conversationId, userId, content, finder } = params;
  if (!finder || !params.isCoachPro) return { entry: null };

  const recent = await storage.getChatMessages(conversationId, 20, userId);
  const entry = decideCoachFinderEntry(
    recent,
    content,
    classifiedIntent,
    finder.action,
    { offer: offerOn },
  );
  let finderEntry: CoachFinderTurnEntry | null = null;
  if (entry.kind === "finder") {
    finderEntry = { kind: "finder", input: entry.input, offer: offerOn };
  } else if (entry.kind === "classify") {
    const turn = await classifyTurn(content, entry.recipeTitle);
    // Offer on (H3): only refine_current stays in the finder; new_request
    // and other go to the tool loop, where the model decides.
    if (turn === "new_request" && !offerOn) {
      finderEntry = {
        kind: "finder",
        input: { kind: "start", text: content },
      };
    } else if (turn === "refine_current") {
      finderEntry = { kind: "refine" };
    }
  }
  return { history: recent, entry: finderEntry };
}
