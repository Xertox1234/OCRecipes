import { z } from "zod";
import {
  allergenIdSchema,
  allergySeveritySchema,
  type AllergenId,
} from "../constants/allergens";

/**
 * Coach write cards (spec docs/superpowers/specs/2026-11-09-coach-write-cards-design.md).
 *
 * A write card is SERVER-BUILT from a write tool call: the payload holds the
 * numbers the server resolved (nutrition lookup, the user's lists, recipe ids)
 * and is stored on the `coach_write_cards` row. The app only ever sends EDITS —
 * counts, ticks, choices among the card's own options — never nutrition, titles
 * or ids of its own. Every edit schema is strict for that reason.
 */

export const WRITE_CARD_KINDS = [
  "food",
  "grocery",
  "plan",
  "pantry",
  "goals",
  "allergy",
] as const;
export type WriteCardKind = (typeof WRITE_CARD_KINDS)[number];

export const WRITE_CARD_STATUSES = [
  "live",
  "saved",
  "replaced",
  "expired",
] as const;
export type WriteCardStatus = (typeof WRITE_CARD_STATUSES)[number];

export const writeCardMealTypeSchema = z.enum([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);
export type WriteCardMealType = z.infer<typeof writeCardMealTypeSchema>;

export const writeCardDaySchema = z.enum(["today", "yesterday"]);
export type WriteCardDay = z.infer<typeof writeCardDaySchema>;

const MAX_FOOD_COUNT = 20;
const nonNegative = z.number().finite().min(0);

// ── Payloads (server-resolved) ──────────────────────────────────────

export const foodCardPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        unitLabel: z.string().min(1).max(60),
        perUnit: z.object({
          calories: nonNegative,
          protein: nonNegative,
          carbs: nonNegative,
          fat: nonNegative,
        }),
        count: z.number().int().min(0).max(MAX_FOOD_COUNT),
        source: z.enum(["lookup", "estimate"]),
      }),
    )
    .min(1)
    .max(8),
  mealType: writeCardMealTypeSchema,
  day: writeCardDaySchema,
});
export type FoodCardPayload = z.infer<typeof foodCardPayloadSchema>;

export const groceryCardPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        quantity: z.string().max(40).nullable(),
        unit: z.string().max(40).nullable(),
        ticked: z.boolean(),
      }),
    )
    .min(1)
    .max(40),
  lists: z.array(z.object({ id: z.number().int(), title: z.string() })).max(4),
  defaultListId: z.number().int().nullable(),
  newListName: z.string().min(1).max(100),
});
export type GroceryCardPayload = z.infer<typeof groceryCardPayloadSchema>;

export const planRecipeRefSchema = z.object({
  source: z.enum(["community", "mine"]),
  id: z.number().int(),
  title: z.string(),
  calories: nonNegative,
  protein: nonNegative,
});
export type PlanRecipeRef = z.infer<typeof planRecipeRefSchema>;

/** "community:12": the key a plan card's shopping section names a recipe by. */
export const planRecipeKey = (r: { source: string; id: number }) =>
  `${r.source}:${r.id}`;

/**
 * The plan card's shopping section (Coach roadmap A1): present when the user
 * asked for the meals and the grocery list in one go. The card then saves
 * both, and the section starts switched on.
 */
export const planShoppingSchema = z.object({
  lists: z.array(z.object({ id: z.number().int(), title: z.string() })).max(4),
  defaultListId: z.number().int().nullable(),
  newListName: z.string().min(1).max(100),
  /** Ingredient names per recipe (`planRecipeKey`), for the card's preview. */
  ingredients: z.record(z.string(), z.array(z.string().max(80)).max(30)),
});
export type PlanShopping = z.infer<typeof planShoppingSchema>;

export const planCardPayloadSchema = z.object({
  rows: z
    .array(
      z.object({
        plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        mealType: writeCardMealTypeSchema,
        recipe: planRecipeRefSchema,
        alternatives: z.array(planRecipeRefSchema).max(3),
        alreadyPlanned: z.string().nullable(),
      }),
    )
    .min(1)
    .max(7),
  shoppingListId: z.number().int().nullable(),
  shopping: planShoppingSchema.optional(),
});
export type PlanCardPayload = z.infer<typeof planCardPayloadSchema>;

/**
 * The pantry card (spec 2026-11-16): one row per change. `add` with an
 * `itemId` tops up that pantry row; without one it makes a new row. `use` and
 * `remove` always name a row. `held` is what the row held when the card was
 * built: the save skips a row whose quantity has changed since.
 */
export const pantryCardPayloadSchema = z.object({
  rows: z
    .array(
      z.object({
        action: z.enum(["add", "use", "remove"]),
        name: z.string().min(1).max(200),
        /** The amount added or used; null for a remove, or when unknown. */
        quantity: z.string().max(40).nullable(),
        unit: z.string().max(40).nullable(),
        itemId: z.number().int().positive().nullable(),
        held: z.string().max(40).nullable(),
        /** A `use` that empties the row: the row is removed on save. */
        all: z.boolean(),
        expiresInDays: z.number().int().min(1).max(365).nullable(),
      }),
    )
    .min(1)
    .max(20),
});
export type PantryCardPayload = z.infer<typeof pantryCardPayloadSchema>;

/**
 * The goals card (Coach roadmap T1): one row per daily goal the Coach proposes
 * to change. `current` is the goal when the card was built (null: none set).
 * The bounds are GOAL_LIMITS; calories never go under the 1,200 floor the goal
 * calculator uses, though the Goals screen itself accepts less.
 */
export const GOAL_KEYS = ["calories", "protein", "carbs", "fat"] as const;
export type GoalKey = (typeof GOAL_KEYS)[number];

export const GOAL_LIMITS: Record<
  GoalKey,
  { min: number; max: number; step: number }
> = {
  calories: { min: 1200, max: 10000, step: 50 },
  protein: { min: 0, max: 500, step: 5 },
  carbs: { min: 0, max: 1000, step: 5 },
  fat: { min: 0, max: 500, step: 5 },
};

/** Whether `value` is a whole number inside the goal's bounds. */
export function isGoalValue(key: GoalKey, value: number): boolean {
  const { min, max } = GOAL_LIMITS[key];
  return Number.isInteger(value) && value >= min && value <= max;
}

export const goalsCardPayloadSchema = z.object({
  rows: z
    .array(
      z
        .object({
          key: z.enum(GOAL_KEYS),
          current: z.number().int().min(0).nullable(),
          proposed: z.number().int(),
        })
        .refine((r) => isGoalValue(r.key, r.proposed), {
          message: "proposed is outside the goal's bounds.",
        }),
    )
    .min(1)
    .max(GOAL_KEYS.length)
    .refine((rows) => new Set(rows.map((r) => r.key)).size === rows.length, {
      message: "One row per goal.",
    }),
});
export type GoalsCardPayload = z.infer<typeof goalsCardPayloadSchema>;

/**
 * The allergy card (Coach roadmap T1): one allergen to add to the dietary
 * profile. Only the nine the profile editor holds. The severity is never the
 * Coach's guess: the user picks it on the card, so it lives in the edits.
 */
export const allergyCardPayloadSchema = z.object({
  allergen: allergenIdSchema,
});
export type AllergyCardPayload = z.infer<typeof allergyCardPayloadSchema>;

/** "tree nuts" for `tree_nuts`: the allergen as a word in a sentence. */
export const allergenWord = (id: AllergenId) => id.replace(/_/g, " ");

// ── Edits (client-sent, strict) ─────────────────────────────────────

export const foodEditsSchema = z
  .object({
    counts: z.array(z.number().int().min(0).max(MAX_FOOD_COUNT)).max(8),
    mealType: writeCardMealTypeSchema,
    day: writeCardDaySchema,
  })
  .partial()
  .strict();
export type FoodCardEdits = z.infer<typeof foodEditsSchema>;

export const groceryEditsSchema = z
  .object({
    ticked: z.array(z.boolean()).max(40),
    listId: z.union([z.number().int(), z.literal("new")]),
  })
  .partial()
  .strict();
export type GroceryCardEdits = z.infer<typeof groceryEditsSchema>;

export const planEditsSchema = z
  .object({
    removed: z.array(z.boolean()).max(7),
    chosen: z.array(z.number().int().min(0).max(2).nullable()).max(7),
    addShopping: z.boolean(),
    /** Only for a card with a shopping section: one of its lists, or a new one. */
    shoppingListId: z.union([z.number().int(), z.literal("new")]),
  })
  .partial()
  .strict();
export type PlanCardEdits = z.infer<typeof planEditsSchema>;

export const pantryEditsSchema = z
  .object({ ticked: z.array(z.boolean()).max(20) })
  .partial()
  .strict();
export type PantryCardEdits = z.infer<typeof pantryEditsSchema>;

/** The value each row holds now, by row; bounds are checked against the row's
 *  goal at save (the row's key is the server's, not the app's). */
export const goalsEditsSchema = z
  .object({ values: z.array(z.number().int()).max(GOAL_KEYS.length) })
  .partial()
  .strict();
export type GoalsCardEdits = z.infer<typeof goalsEditsSchema>;

export const allergyEditsSchema = z
  .object({ severity: allergySeveritySchema })
  .partial()
  .strict();
export type AllergyCardEdits = z.infer<typeof allergyEditsSchema>;

export const WRITE_CARD_EDITS_SCHEMAS = {
  food: foodEditsSchema,
  grocery: groceryEditsSchema,
  plan: planEditsSchema,
  pantry: pantryEditsSchema,
  goals: goalsEditsSchema,
  allergy: allergyEditsSchema,
} as const;

export const WRITE_CARD_PAYLOAD_SCHEMAS = {
  food: foodCardPayloadSchema,
  grocery: groceryCardPayloadSchema,
  plan: planCardPayloadSchema,
  pantry: pantryCardPayloadSchema,
  goals: goalsCardPayloadSchema,
  allergy: allergyCardPayloadSchema,
} as const;

export type WriteCardPayload =
  | FoodCardPayload
  | GroceryCardPayload
  | PlanCardPayload
  | PantryCardPayload
  | GoalsCardPayload
  | AllergyCardPayload;
export type WriteCardEdits =
  | FoodCardEdits
  | GroceryCardEdits
  | PlanCardEdits
  | PantryCardEdits
  | GoalsCardEdits
  | AllergyCardEdits;

// ── Block ───────────────────────────────────────────────────────────

/**
 * The chat block. A plain object (the coach block union discriminates on
 * `type`, so this cannot itself be a union); the kind/payload pairing is
 * checked by the refinement in `writeCardBlockSchema`, and `coachBlockSchema`
 * registers the unrefined object.
 */
export const writeCardBlockObjectSchema = z.object({
  type: z.literal("write_card"),
  cardId: z.string().uuid(),
  kind: z.enum(WRITE_CARD_KINDS),
  payload: z.union([
    foodCardPayloadSchema,
    groceryCardPayloadSchema,
    planCardPayloadSchema,
    pantryCardPayloadSchema,
    goalsCardPayloadSchema,
    allergyCardPayloadSchema,
  ]),
  status: z.enum(WRITE_CARD_STATUSES),
  replacesCardId: z.string().uuid().optional(),
  receipt: z.string().max(200).optional(),
  /**
   * Coach roadmap T2: the Coach logged this card at once, so the app offers
   * Undo without a Save tap. Dropped on read-back once Undo has closed.
   */
  loggedAtOnce: z.literal(true).optional(),
  /** The stored edits, added when messages are read back (reopened chat). */
  edits: z.record(z.string(), z.unknown()).optional(),
});

export const writeCardBlockSchema = writeCardBlockObjectSchema.superRefine(
  (val, ctx) => {
    if (!WRITE_CARD_PAYLOAD_SCHEMAS[val.kind].safeParse(val.payload).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: `payload does not match kind "${val.kind}"`,
      });
    }
  },
);

export type WriteCardBlock = z.infer<typeof writeCardBlockObjectSchema>;
