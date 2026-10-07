// server/services/recipe-finder/adjust.ts
// Builds the prefilled "adjust" card shown before every recipe generation.
import type { UserProfile } from "@shared/schema";
import {
  COOKING_TIME_IDS,
  type CookingTimeId,
} from "@shared/constants/cooking-times";
import type {
  ClarifyingQuestion,
  FinderAnswer,
  FinderFlow,
  RecipeAdjustBlock,
} from "@shared/schemas/recipe-finder";

const DEFAULT_SERVINGS = 2;
const MAX_LIST = 20;
const MAX_ITEM_LEN = 60;
const MAX_DIET_LEN = 50;

function isCookingTimeId(value: unknown): value is CookingTimeId {
  return (
    typeof value === "string" &&
    (COOKING_TIME_IDS as readonly string[]).includes(value)
  );
}

function clampServings(n: number): number {
  return Math.min(20, Math.max(1, Math.round(n)));
}

export function buildAdjustBlock(args: {
  flow: FinderFlow;
  profile: UserProfile | null | undefined;
  followUps: ClarifyingQuestion[];
  nextFlowId: string;
}): RecipeAdjustBlock {
  const { flow, profile, followUps, nextFlowId } = args;
  // flow.dish is capped at 80 chars, but query.q allows 200.
  const dish = (flow.dish ?? flow.query.q).slice(0, 80).trim() || "recipe";
  const details = flow.details ?? { ingredients: [], fromConversation: false };

  const profileServings =
    typeof profile?.householdSize === "number" &&
    Number.isFinite(profile.householdSize)
      ? profile.householdSize
      : undefined;
  const servings = clampServings(
    details.servings ?? profileServings ?? DEFAULT_SERVINGS,
  );
  const time: CookingTimeId =
    details.time ??
    (isCookingTimeId(profile?.cookingTimeAvailable)
      ? profile.cookingTimeAvailable
      : "moderate");

  const allergies = Array.isArray(profile?.allergies) ? profile.allergies : [];
  const dislikes = Array.isArray(profile?.foodDislikes)
    ? profile.foodDislikes
    : [];

  return {
    type: "recipe_adjust",
    prefill: { servings, spice: details.spice ?? "mild", time },
    avoiding: allergies
      .map((a) => String(a.name).slice(0, MAX_ITEM_LEN))
      .slice(0, MAX_LIST),
    noted: {
      ...(profile?.dietType
        ? { dietType: profile.dietType.slice(0, MAX_DIET_LEN) }
        : {}),
      dislikes: dislikes
        .map((d) => String(d).slice(0, MAX_ITEM_LEN))
        .slice(0, MAX_LIST),
    },
    followUps,
    flow: { ...flow, stage: "adjust", flowId: nextFlowId, dish },
  };
}

/** True iff every answer is an offered question + option pair of the block. */
export function validateAdjustAnswers(
  block: RecipeAdjustBlock,
  answers: FinderAnswer[],
): boolean {
  return answers.every((a) =>
    block.followUps.some(
      (q) => q.question === a.question && q.options.includes(a.answer),
    ),
  );
}
