import { z } from "zod";

/**
 * Coach write cards (spec docs/superpowers/specs/2026-11-09-coach-write-cards-design.md).
 *
 * A write card is SERVER-BUILT from a write tool call: the payload holds the
 * numbers the server resolved (nutrition lookup, the user's lists, recipe ids)
 * and is stored on the `coach_write_cards` row. The app only ever sends EDITS —
 * counts, ticks, choices among the card's own options — never nutrition, titles
 * or ids of its own. Every edit schema is strict for that reason.
 */

export const WRITE_CARD_KINDS = ["food", "grocery", "plan"] as const;
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
});
export type PlanCardPayload = z.infer<typeof planCardPayloadSchema>;

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
  })
  .partial()
  .strict();
export type PlanCardEdits = z.infer<typeof planEditsSchema>;

export const WRITE_CARD_EDITS_SCHEMAS = {
  food: foodEditsSchema,
  grocery: groceryEditsSchema,
  plan: planEditsSchema,
} as const;

export const WRITE_CARD_PAYLOAD_SCHEMAS = {
  food: foodCardPayloadSchema,
  grocery: groceryCardPayloadSchema,
  plan: planCardPayloadSchema,
} as const;

export type WriteCardPayload =
  | FoodCardPayload
  | GroceryCardPayload
  | PlanCardPayload;
export type WriteCardEdits = FoodCardEdits | GroceryCardEdits | PlanCardEdits;

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
  ]),
  status: z.enum(WRITE_CARD_STATUSES),
  replacesCardId: z.string().uuid().optional(),
  receipt: z.string().max(200).optional(),
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
