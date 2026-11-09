import { z } from "zod";
import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  foodEditsSchema,
  writeCardDaySchema,
  writeCardMealTypeSchema,
  type FoodCardEdits,
  type FoodCardPayload,
} from "@shared/schemas/coach-write-cards";
import { foodCounts } from "@shared/lib/coach-write-card-math";
import { lookupNutrition as defaultLookupNutrition } from "../nutrition-lookup";
import { inferMealTimeHint } from "../../lib/meal-time-hint";
import { civilHourInTz } from "../../lib/civil-date";
import {
  createScannedItemWithLog,
  softDeleteScannedItem,
} from "../../storage/nutrition";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import { logger, toError } from "../../lib/logger";
import { WriteCardEditError } from "./errors";

/**
 * Food write card (spec 2026-11-09). The model proposes items, counts and an
 * estimate; the server replaces the estimate with a nutrition lookup when one
 * answers on a plausible basis. Saving writes one log entry per kept item with
 * `servings` = the count — the same shape Quick Log uses for a servings stepper.
 */

const estimateSchema = z.object({
  calories: z.number().finite().min(0).max(5000),
  protein: z.number().finite().min(0).max(500),
  carbs: z.number().finite().min(0).max(1000),
  fat: z.number().finite().min(0).max(500),
});

export const logFoodCardArgsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        count: z.number().int().min(1).max(20),
        unitLabel: z.string().trim().min(1).max(60),
        estimate: estimateSchema,
      }),
    )
    .min(1)
    .max(8),
  mealType: writeCardMealTypeSchema.optional(),
  day: writeCardDaySchema.optional(),
});
export type LogFoodCardArgs = z.infer<typeof logFoodCardArgsSchema>;

/**
 * A lookup further than this factor from the model's per-unit estimate is
 * almost always a different basis (a per-100 g row for "one egg"), so the
 * estimate stands.
 */
const PLAUSIBLE_FACTOR = 3;

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
    let found: Awaited<ReturnType<typeof defaultLookupNutrition>> = null;
    try {
      found = await deps.lookupNutrition(`1 ${item.unitLabel} ${item.name}`);
    } catch (err) {
      logger.warn(
        { err: toError(err) },
        "write card nutrition lookup failed; using the estimate",
      );
    }
    const est = item.estimate.calories;
    const plausible =
      found != null &&
      (est === 0 ||
        (found.calories <= est * PLAUSIBLE_FACTOR &&
          found.calories >= est / PLAUSIBLE_FACTOR));
    items.push({
      name: item.name,
      unitLabel: item.unitLabel,
      count: item.count,
      source: plausible ? "lookup" : "estimate",
      perUnit:
        plausible && found
          ? {
              calories: found.calories,
              protein: found.protein,
              carbs: found.carbs,
              fat: found.fat,
            }
          : item.estimate,
    });
  }
  return {
    items,
    mealType:
      args.mealType ?? inferMealTimeHint(civilHourInTz(ctx.now, ctx.tz)),
    day: args.day ?? "today",
  };
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

const DAY_MS = 24 * 60 * 60 * 1000;

export async function performFoodSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string; now: Date },
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
    day === "yesterday" ? new Date(ctx.now.getTime() - DAY_MS) : undefined;

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
