// Pure helpers for the recipe offer + adjust card (spec 2026-10-06 §3, §4.4).
import {
  COOKING_TIMES,
  type CookingTimeId,
} from "@shared/constants/cooking-times";
import type {
  FinderAction,
  FinderAnswer,
  RecipeAdjustBlock,
  SpiceLevel,
} from "@shared/schemas/recipe-finder";

export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 20;

export const SPICE_LABELS: Record<SpiceLevel, string> = {
  mild: "Mild",
  medium: "Medium",
  hot: "Hot",
};

export interface AdjustState {
  servings: number;
  spice: SpiceLevel;
  time: CookingTimeId;
  /** question → chosen option; unanswered questions are simply absent. */
  answers: Record<string, string>;
}

/** A chat screen's adjust-card choices, keyed by the card's flowId. */
export type AdjustChoicesStore = Map<string, AdjustState>;

export function clampServings(n: number): number {
  if (!Number.isFinite(n)) return MIN_SERVINGS;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(n)));
}

export function timeLabel(id: CookingTimeId): string {
  return COOKING_TIMES.find((t) => t.id === id)?.description ?? id;
}

/**
 * The server rejects any answer that isn't an offered question + option
 * (spec §4.5 M1), and `answers` must hold at least one entry when present —
 * so only answered, offered pairs go out, copied verbatim from the block.
 */
export function buildAdjustAction(
  block: RecipeAdjustBlock,
  state: AdjustState,
): FinderAction {
  const answers: FinderAnswer[] = block.followUps.flatMap((q) => {
    const answer = state.answers[q.question];
    return answer !== undefined && q.options.includes(answer)
      ? [{ question: q.question, answer }]
      : [];
  });
  return {
    type: "adjust_generate",
    flowId: block.flow.flowId,
    settings: {
      servings: clampServings(state.servings),
      spice: state.spice,
      time: state.time,
    },
    ...(answers.length > 0 ? { answers } : {}),
  };
}

// RecipeChef's offer text is the old-client fallback, which ends with a
// typed-reply hint; the buttons replace that hint, so it isn't shown above them.
const REPLY_HINT = /\n*Reply "yes", "search", or "no"\.\s*$/;

/** The offer copy the server wrote, minus the old-client reply hint. */
export function offerDisplayText(content: string | undefined): string {
  if (!content) return "";
  return content.replace(REPLY_HINT, "").trimEnd();
}

export function avoidingAccessibilityLabel(avoiding: string[]): string {
  return `Avoiding ${avoiding.join(", ")}. Change allergies in your profile.`;
}

/** "Pescatarian · dislikes olives", or null when there's nothing to note. */
export function notedText(noted: RecipeAdjustBlock["noted"]): string | null {
  const parts: string[] = [];
  if (noted.dietType) {
    parts.push(
      noted.dietType.charAt(0).toUpperCase() + noted.dietType.slice(1),
    );
  }
  if (noted.dislikes.length > 0) {
    parts.push(`dislikes ${noted.dislikes.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** VoiceOver/TalkBack swipe up/down on the servings stepper. */
export function servingsAfterAccessibilityAction(
  servings: number,
  actionName: string,
): number {
  if (actionName === "increment") return clampServings(servings + 1);
  if (actionName === "decrement") return clampServings(servings - 1);
  return servings;
}
