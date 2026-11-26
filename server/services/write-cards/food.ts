import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  foodEditsSchema,
  type FoodCardEdits,
  type FoodCardPayload,
} from "@shared/schemas/coach-write-cards";
import { foodCounts } from "@shared/lib/coach-write-card-math";
import { lookupNutrition as defaultLookupNutrition } from "../nutrition-lookup";
import { parseServingGrams } from "../barcode-lookup";
import { scaleToGrams } from "../portion-nutrition";
import { inferMealTimeHint } from "../../lib/meal-time-hint";
import {
  civilHourInTz,
  sameElapsedTimeOnPreviousDay,
} from "../../lib/civil-date";
import {
  createScannedItemWithLog,
  softDeleteScannedItem,
} from "../../storage/nutrition";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import { logger, toError } from "../../lib/logger";
import { WriteCardEditError } from "./errors";
import type { LogFoodCardArgs } from "./tool-args";

export { logFoodCardArgsSchema, type LogFoodCardArgs } from "./tool-args";

/**
 * Food write card (spec 2026-11-09). The model proposes items, counts and an
 * estimate; the server replaces the estimate with a nutrition lookup when the
 * unit states its weight and the lookup agrees with the estimate. Saving writes one log entry per kept item with
 * `servings` = the count — the same shape Quick Log uses for a servings stepper.
 */

type PerUnit = FoodCardPayload["items"][number]["perUnit"];

/**
 * A lookup further than this factor from the model's per-unit calories is
 * almost always a different food or amount, so the estimate stands.
 */
const PLAUSIBLE_FACTOR = 3;

/**
 * How far a lookup's protein, carbs and fat may sit from the estimate's,
 * counted in calories (4/4/9) as a share of the larger calorie figure. The
 * calorie check alone let "Eggs, Grade A, Large, egg white" answer for a whole
 * egg: close calories, no fat.
 */
const MAX_MACRO_SPLIT_DISTANCE = 0.5;

/**
 * A row whose macros account for less than half or more than 1.5x its
 * calories is not trusted (below ENERGY_CHECK_MIN_CALORIES the rounding alone
 * breaks the ratio). Alcohol fails this too, and keeps the estimate.
 */
const ENERGY_CHECK_MIN_CALORIES = 20;

function macroCalories(v: PerUnit): number {
  return 4 * v.protein + 4 * v.carbs + 9 * v.fat;
}

function lookupAgreesWithEstimate(found: PerUnit, estimate: PerUnit): boolean {
  if (
    found.calories > estimate.calories * PLAUSIBLE_FACTOR ||
    found.calories < estimate.calories / PLAUSIBLE_FACTOR
  ) {
    return false;
  }
  if (found.calories >= ENERGY_CHECK_MIN_CALORIES) {
    const ratio = macroCalories(found) / found.calories;
    if (ratio < 0.5 || ratio > 1.5) return false;
  }
  const distance =
    4 * Math.abs(found.protein - estimate.protein) +
    4 * Math.abs(found.carbs - estimate.carbs) +
    9 * Math.abs(found.fat - estimate.fat);
  const scale = Math.max(found.calories, estimate.calories);
  return distance <= scale * MAX_MACRO_SPLIT_DISTANCE;
}

/**
 * The lookup's values for ONE unit, or null when they can't be worked out.
 *
 * The sources answer a text query per 100 g (CNF, USDA) or per a weighed
 * serving (API Ninjas), never per "egg" or "slice". So a row can stand in for
 * one unit only when the unit states its weight ("100 g", "cup (240 g)"), and
 * it is scaled to that weight. For a counted unit the model's estimate stands,
 * and no lookup is made.
 */
async function lookupPerUnit(
  item: LogFoodCardArgs["items"][number],
  lookupNutrition: typeof defaultLookupNutrition,
): Promise<PerUnit | null> {
  const unitGrams = parseServingGrams(item.unitLabel);
  if (!unitGrams) return null;

  let found: Awaited<ReturnType<typeof defaultLookupNutrition>> = null;
  try {
    // The food alone: a quantity in the query hurts the sources' matching.
    found = await lookupNutrition(item.name);
  } catch (err) {
    logger.warn(
      { err: toError(err) },
      "write card nutrition lookup failed; using the estimate",
    );
  }
  if (!found) return null;

  const scaled = scaleToGrams(found, unitGrams);
  if (
    !scaled ||
    scaled.calories == null ||
    scaled.protein == null ||
    scaled.carbs == null ||
    scaled.fat == null
  ) {
    return null;
  }
  const perUnit = {
    calories: scaled.calories,
    protein: scaled.protein,
    carbs: scaled.carbs,
    fat: scaled.fat,
  };
  return lookupAgreesWithEstimate(perUnit, item.estimate) ? perUnit : null;
}

export async function buildFoodPayload(
  args: LogFoodCardArgs,
  ctx: { tz: string; now: Date },
  deps: { lookupNutrition: typeof defaultLookupNutrition } = {
    lookupNutrition: defaultLookupNutrition,
  },
): Promise<FoodCardPayload> {
  const items: FoodCardPayload["items"] = [];
  // One at a time: lookups hit external APIs; a reply has at most 8 items.
  for (const item of args.items) {
    const looked = await lookupPerUnit(item, deps.lookupNutrition);
    items.push({
      name: item.name,
      unitLabel: item.unitLabel,
      count: item.count,
      source: looked ? "lookup" : "estimate",
      perUnit: looked ?? item.estimate,
    });
  }
  return {
    items,
    mealType:
      args.mealType ?? inferMealTimeHint(civilHourInTz(ctx.now, ctx.tz)),
    day: args.day ?? "today",
  };
}

/**
 * A food log small enough to apply at once, with Undo, rather than wait on
 * the card's Save (Coach roadmap T2): up to three foods and 1000 kcal in all.
 * Anything bigger (a whole day's eating, a feast) keeps the card the user
 * checks first. Only a log the user typed in the chat is applied at once; a
 * photo, label or barcode read always waits on Save, so the user can check
 * the numbers against the food.
 */
const SMALL_LOG_MAX_ITEMS = 3;
const SMALL_LOG_MAX_CALORIES = 1000;

export function isSmallFoodLog(payload: FoodCardPayload): boolean {
  if (payload.items.length > SMALL_LOG_MAX_ITEMS) return false;
  const total = payload.items.reduce(
    (sum, it) => sum + it.count * it.perUnit.calories,
    0,
  );
  return total <= SMALL_LOG_MAX_CALORIES;
}

function parseFoodEdits(p: FoodCardPayload, raw: unknown): FoodCardEdits {
  const parsed = foodEditsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  if (parsed.data.counts && parsed.data.counts.length !== p.items.length) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  return parsed.data;
}

export async function performFoodSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string; tz: string; now: Date },
): Promise<CoachWriteCardSavedRefs> {
  const payload = card.payload as FoodCardPayload;
  const edits = parseFoodEdits(payload, rawEdits);
  const counts = foodCounts(payload, edits);
  if (counts.every((c) => c === 0)) {
    throw new WriteCardEditError("Nothing to log.");
  }
  const mealType = edits.mealType ?? payload.mealType;
  const day = edits.day ?? payload.day;
  const occurredAt =
    day === "yesterday"
      ? sameElapsedTimeOnPreviousDay(ctx.now, ctx.tz)
      : undefined;

  const scannedItemIds: number[] = [];
  // Sequential on one tx client (database rules: never Promise.all on a tx).
  for (let i = 0; i < payload.items.length; i++) {
    if (counts[i] === 0) continue;
    const item = payload.items[i];
    const scanned = await createScannedItemWithLog(
      {
        userId: ctx.userId,
        productName: item.name,
        servingSize: item.unitLabel,
        calories: String(item.perUnit.calories),
        protein: String(item.perUnit.protein),
        carbs: String(item.perUnit.carbs),
        fat: String(item.perUnit.fat),
        sourceType: "coach",
      },
      {
        mealType,
        source: "coach",
        servings: String(counts[i]),
        ...(occurredAt && { occurredAt }),
      },
      tx,
    );
    scannedItemIds.push(scanned.id);
  }
  return { scannedItemIds };
}

export async function revertFoodSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
): Promise<void> {
  for (const id of card.savedRefs?.scannedItemIds ?? []) {
    await softDeleteScannedItem(id, card.userId, tx);
  }
}
