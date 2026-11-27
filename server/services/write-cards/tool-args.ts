import { z } from "zod";
import {
  GOAL_KEYS,
  GOAL_LIMITS,
  writeCardDaySchema,
  writeCardMealTypeSchema,
  type GoalKey,
  type ReminderKey,
} from "@shared/schemas/coach-write-cards";
import { allergenIdSchema, type AllergenId } from "@shared/constants/allergens";
import { FAMILY_NAME_MAX } from "@shared/types/family";
import { containsUnsafeCoachAdvice } from "../../lib/ai-safety";
import { isValidCalendarDate } from "../../utils/date-validation";

/**
 * Write-tool argument schemas (spec 2026-11-09). DB-FREE on purpose:
 * coach-tools.ts validates with these, and importing the card modules there
 * would pull storage and server/db.ts into every coach-tools importer.
 */

/**
 * Text the model writes for a card. The card shows and saves it without it
 * ever passing through the reply's output screen, so that screen runs here:
 * a hit fails the tool call, and the model is told the arguments were refused.
 */
const cardText = (text: z.ZodString) =>
  text.refine((value) => !containsUnsafeCoachAdvice(value), {
    message: "This text cannot go on a card.",
  });

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
        name: cardText(z.string().trim().min(1).max(200)),
        count: z.number().int().min(1).max(20),
        unitLabel: cardText(z.string().trim().min(1).max(60)),
        estimate: estimateSchema,
      }),
    )
    .min(1)
    .max(8),
  mealType: writeCardMealTypeSchema.optional(),
  day: writeCardDaySchema.optional(),
});
export type LogFoodCardArgs = z.infer<typeof logFoodCardArgsSchema>;

export const addGroceryCardArgsSchema = z.object({
  items: z
    .array(
      z.object({
        name: cardText(z.string().trim().min(1).max(200)),
        quantity: cardText(z.string().trim().max(40)).optional(),
        unit: cardText(z.string().trim().max(40)).optional(),
        maybeHave: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(40),
  listName: cardText(z.string().trim().min(1).max(100)).optional(),
});
export type AddGroceryCardArgs = z.infer<typeof addGroceryCardArgsSchema>;

export const recipeRefArgSchema = z.object({
  source: z.enum(["community", "mine"]),
  id: z.number().int().positive(),
});

export const addMealPlanCardArgsSchema = z.object({
  rows: z
    .array(
      z.object({
        // A real calendar date: a regex alone let "2026-02-30" reach
        // Postgres (reliability audit 2026-11-19, L-xc-4).
        plannedDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(isValidCalendarDate),
        mealType: writeCardMealTypeSchema,
        recipe: recipeRefArgSchema,
        alternatives: z.array(recipeRefArgSchema).max(3).default([]),
      }),
    )
    .min(1)
    .max(7),
  /** The user asked for the grocery list too: the one card saves both (A1). */
  withGroceryList: z.boolean().optional(),
});
export type AddMealPlanCardArgs = z.infer<typeof addMealPlanCardArgsSchema>;

export type RecipeRefArg = z.infer<typeof recipeRefArgSchema>;

/**
 * Pantry card (spec 2026-11-16). A `use` or `remove` names a pantry row by the
 * id `get_pantry_items` returned; the amount of a `use` is in that row's unit.
 */
const pantryChangeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    name: cardText(z.string().trim().min(1).max(200)),
    quantity: cardText(z.string().trim().max(40)).optional(),
    unit: cardText(z.string().trim().max(40)).optional(),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  }),
  z
    .object({
      action: z.literal("use"),
      itemId: z.number().int().positive(),
      quantity: z.string().trim().min(1).max(40).optional(),
      all: z.boolean().optional(),
    })
    .refine((c) => c.all === true || c.quantity !== undefined, {
      message: "Give a quantity, or all: true.",
    }),
  z.object({
    action: z.literal("remove"),
    itemId: z.number().int().positive(),
  }),
]);

export const updatePantryCardArgsSchema = z.object({
  changes: z.array(pantryChangeSchema).min(1).max(20),
});
export type UpdatePantryCardArgs = z.infer<typeof updatePantryCardArgsSchema>;

/**
 * Goals card (Coach roadmap T1). The bounds are GOAL_LIMITS: calories never
 * go under the 1,200 floor the goal calculator uses. Fractions are allowed
 * here; the card builder rounds to the stepper's grid.
 */
const goalArg = (key: GoalKey) =>
  z.number().finite().min(GOAL_LIMITS[key].min).max(GOAL_LIMITS[key].max);

export const setGoalsCardArgsSchema = z
  .object({
    calories: goalArg("calories").optional(),
    protein: goalArg("protein").optional(),
    carbs: goalArg("carbs").optional(),
    fat: goalArg("fat").optional(),
  })
  .refine((a) => GOAL_KEYS.some((k) => a[k] !== undefined), {
    message: "Give at least one goal.",
  });
export type SetGoalsCardArgs = z.infer<typeof setGoalsCardArgsSchema>;

/**
 * Reminders card (Coach roadmap A3): each reminder type the user wants on
 * (true) or off (false), by the tool's plain names.
 */
export const REMINDER_ARG_KEYS = {
  mealLog: "meal-log",
  commitment: "commitment",
  dailyCheckin: "daily-checkin",
  expiringFood: "pantry-expiring",
} as const satisfies Record<string, ReminderKey>;
type ReminderArgKey = keyof typeof REMINDER_ARG_KEYS;

export const setRemindersCardArgsSchema = z
  .object({
    mealLog: z.boolean().optional(),
    commitment: z.boolean().optional(),
    dailyCheckin: z.boolean().optional(),
    expiringFood: z.boolean().optional(),
  })
  .refine(
    (a) =>
      (Object.keys(REMINDER_ARG_KEYS) as ReminderArgKey[]).some(
        (k) => a[k] !== undefined,
      ),
    { message: "Give at least one reminder." },
  );
export type SetRemindersCardArgs = z.infer<typeof setRemindersCardArgsSchema>;

/**
 * Family card (Coach roadmap A3; owner ruling 2026-11-27): one new family
 * member, from what the user typed. Only the nine allergens the Family
 * editor holds; the user picks each severity on the card.
 */
export const addFamilyMemberCardArgsSchema = z.object({
  name: cardText(z.string().trim().min(1).max(FAMILY_NAME_MAX)),
  allergens: z.array(allergenIdSchema).max(9).default([]),
});
export type AddFamilyMemberCardArgs = z.infer<
  typeof addFamilyMemberCardArgsSchema
>;

/** Why no family card was made: the family is full, the allergies need the
 *  health-data agreement, or someone of that name is already in it. */
export type FamilyCardRefusal = "limit" | "consent" | "duplicate";

/** A write tool call in write-card mode, args already validated. */
export type WriteCardProposal =
  | { kind: "food"; args: LogFoodCardArgs }
  | { kind: "grocery"; args: AddGroceryCardArgs }
  | { kind: "pantry"; args: UpdatePantryCardArgs }
  | { kind: "goals"; args: SetGoalsCardArgs }
  | { kind: "reminders"; args: SetRemindersCardArgs }
  | { kind: "family"; args: AddFamilyMemberCardArgs }
  /** No tool: the server turns the Coach's add_allergy action card into it. */
  | { kind: "allergy"; args: { allergen: AllergenId } }
  | {
      kind: "plan";
      args: AddMealPlanCardArgs;
      /** Community ids find_plan_recipes returned this turn, for Swap. */
      pool?: number[];
      /** The app can draw the card's shopping section (A1). */
      shopping?: boolean;
    };

/**
 * What became of a proposal, when the caller already knows. The grocery and
 * pantry cards report one: each is worked out during the tool call, so the
 * model hears what changed before it writes the reply.
 *   - grocery: the names are the model's own item names.
 *   - pantry: `rows` describe the card's rows and DO carry pantry row names,
 *     which the user typed; the tool sanitizes them before the model sees them.
 */
export type WriteCardOutcome =
  | { kind: "grocery"; shown: true; leftOff: string[]; unticked: string[] }
  | { kind: "grocery"; shown: false; leftOff: string[] }
  | { kind: "pantry"; shown: boolean; rows: string[]; dropped: number }
  /** goals: `rows` is the card's own line (goal names and numbers only). */
  | { kind: "goals"; shown: boolean; rows: string }
  /** reminders: `rows` is the card's own line (reminder names, on or off). */
  | { kind: "reminders"; shown: boolean; rows: string }
  /**
   * family: `rows` is the card's own line (the name and allergens the model
   * proposed); `refused` says why no card was made. Never stored profiles.
   */
  | {
      kind: "family";
      shown: boolean;
      rows: string;
      refused?: FamilyCardRefusal;
    }
  /**
   * plan: `meals` are the card's rows ("2026-11-25 dinner: Lentil stew") and
   * `dropped` counts the asked-for meals whose recipe could not be used.
   * `shown` is absent when the card is built at the end of the turn instead.
   * `groceryList`: whether the card also saves the list the user asked for.
   */
  | {
      kind: "plan";
      shown?: boolean;
      meals?: string[];
      dropped?: number;
      groceryList?: "on_card" | "not_on_card";
    }
  /** food: `loggedAtOnce` when the turn logs this card at once (T2). */
  | { kind: "food"; shown: boolean; loggedAtOnce?: true }
  /** A grocery call in a turn whose plan card already holds the shopping. */
  | { kind: "grocery_on_plan_card" };
