/**
 * A meal photo sent into the Coach chat (Coach roadmap S1).
 *
 * The photo runs through the same meal analysis and nutrition lookup as the
 * Scan screen, and the answer is the Coach's own food log card: one row per
 * food, sized to the portion seen in the photo, count 1. The user changes the
 * counts on the card; nothing is saved until they tap it.
 */
import { analyzePhoto, type FoodItem } from "./photo-analysis";
import { batchNutritionLookup, type NutritionData } from "./nutrition-lookup";
import { portionNutrition } from "./portion-nutrition";
import { inferMealTimeHint } from "../lib/meal-time-hint";
import { civilHourInTz } from "../lib/civil-date";
import {
  logFoodCardArgsSchema,
  type WriteCardProposal,
} from "./write-cards/tool-args";
import type { FoodCardPayload } from "@shared/schemas/coach-write-cards";

export { COACH_PHOTO_USER_TEXT } from "@shared/lib/coach-photo";

const MAX_CARD_ITEMS = 8;
const MAX_NAME = 200;
const MAX_UNIT_LABEL = 60;

type PhotoFood = Pick<FoodItem, "name" | "quantity" | "lookupName" | "grams">;
type CardItem = FoodCardPayload["items"][number];

const lookupKey = (f: PhotoFood) => f.lookupName ?? f.name;

/**
 * The rule the Coach's own `log_food_item` rows pass: bounded numbers, and
 * text that clears the unsafe-advice screen. A photo row is model output too
 * (text read from a picture), so it gets the same check.
 */
const cardRowSchema = logFoodCardArgsSchema.shape.items.element;

/**
 * Card rows for the foods that have a nutrition match. `skipped` counts the
 * foods left out: no match, a row the card's rules refuse, or past 8 rows.
 */
export function photoFoodsToCardItems(
  foods: PhotoFood[],
  nutrition: Map<string, NutritionData | null>,
): { items: CardItem[]; skipped: number } {
  const items: CardItem[] = [];
  for (const food of foods) {
    if (items.length === MAX_CARD_ITEMS) break;
    const found = nutrition.get(lookupKey(food));
    const name = food.name.trim().slice(0, MAX_NAME);
    if (!found || !name) continue;
    const portion = portionNutrition(found, food);
    const unitLabel =
      portion.servingSize.trim().slice(0, MAX_UNIT_LABEL) || "portion";
    const perUnit = {
      calories: portion.calories,
      protein: portion.protein,
      carbs: portion.carbs,
      fat: portion.fat,
    };
    const row = { name, unitLabel, count: 1, estimate: perUnit };
    if (!cardRowSchema.safeParse(row).success) continue;
    items.push({ name, unitLabel, perUnit, count: 1, source: "lookup" });
  }
  return { items, skipped: foods.length - items.length };
}

/**
 * The Coach's line above the card. Fixed wording: food names are model
 * output read from a photo, so they stay on the card and out of the saved
 * message text that later turns feed back to the model.
 */
export function photoReplyText(shown: number, skipped: number): string {
  if (shown === 0) {
    return "I couldn't make out food I can log in that photo. Try again with the plate filling the frame, or tell me what you ate.";
  }
  const left =
    skipped > 0
      ? ` I left out ${skipped} ${skipped === 1 ? "item" : "items"} I couldn't find nutrition for.`
      : "";
  return `Here's what I see in your photo. Change any portion that looks off, then log it.${left}`;
}

/** The card's proposal, in the shape a `log_food_item` tool call has. */
export function photoCardProposal(payload: FoodCardPayload): WriteCardProposal {
  return {
    kind: "food",
    args: {
      items: payload.items.map((item) => ({
        name: item.name,
        unitLabel: item.unitLabel,
        count: item.count,
        estimate: item.perUnit,
      })),
      mealType: payload.mealType,
      day: payload.day,
    },
  };
}

/** Analyze the photo and build the food card payload (null: nothing to show). */
export async function buildPhotoFoodCard(
  imageBase64: string,
  ctx: { tz: string; now: Date },
): Promise<{ payload: FoodCardPayload | null; skipped: number }> {
  const analysis = await analyzePhoto(imageBase64, "log");
  const nutrition = await batchNutritionLookup([
    ...new Set(analysis.foods.map(lookupKey)),
  ]);
  const { items, skipped } = photoFoodsToCardItems(analysis.foods, nutrition);
  if (items.length === 0) return { payload: null, skipped };
  return {
    payload: {
      items,
      mealType: inferMealTimeHint(civilHourInTz(ctx.now, ctx.tz)),
      day: "today",
    },
    skipped,
  };
}
