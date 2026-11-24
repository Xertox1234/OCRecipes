import { z } from "zod";

/**
 * The Coach's form block (Coach roadmap T1): a short list of fields the user
 * fills in with taps instead of typing. The model writes the fields; the app
 * sends the answers back as the user's next message. A form only asks: it
 * never saves anything by itself.
 */

const MAX_FIELDS = 4;
/** A number field is a − / + stepper, so its range must be walkable. */
const MAX_NUMBER_STEPS = 200;

// Sized so the longest answer message (4 multi-choice fields, every option
// ticked: 4 × (100 + 2 + 8 × 40 + 14) + 3 = 1747) fits a chat message's
// 2000 characters (server/routes/chat.ts). A number line is shorter: its
// value is bounded below (MAX_NUMBER, MIN_NUMBER_STEP).
/** A number a person would enter: within a million, to 2 decimals at most. */
const MAX_NUMBER = 1_000_000;
const MIN_NUMBER_STEP = 0.01;
const amount = z.number().min(-MAX_NUMBER).max(MAX_NUMBER);

const label = z.string().trim().min(1).max(100);
const option = z.string().trim().min(1).max(40);

const distinct = (values: readonly string[]) =>
  new Set(values.map((v) => v.toLowerCase())).size === values.length;

const options = (max: number) =>
  z.array(option).min(2).max(max).refine(distinct, {
    message: "Options must be different from each other.",
  });

/** Pick one. */
export const formChoiceFieldSchema = z.object({
  kind: z.literal("choice"),
  label,
  options: options(6),
});

/** Pick any number, none included. */
export const formMultiChoiceFieldSchema = z.object({
  kind: z.literal("multi_choice"),
  label,
  options: options(8),
});

/** How far `value` is from `min`, in steps (a whole number when on the grid). */
const stepsFromMin = (f: { min: number; step: number }, value: number) =>
  (value - f.min) / f.step;
const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-6;

export const formNumberFieldSchema = z
  .object({
    kind: z.literal("number"),
    label,
    min: amount,
    max: amount,
    step: z.number().min(MIN_NUMBER_STEP).max(MAX_NUMBER),
    /** Where the stepper starts. */
    value: amount,
    unit: z.string().trim().min(1).max(12).optional(),
  })
  .refine((f) => f.min < f.max, { message: "min must be below max." })
  .refine((f) => f.value >= f.min && f.value <= f.max, {
    message: "value must be between min and max.",
  })
  .refine((f) => isWhole(stepsFromMin(f, f.value)), {
    message: "value must be a whole number of steps from min.",
  })
  .refine((f) => stepsFromMin(f, f.max) <= MAX_NUMBER_STEPS, {
    message: `At most ${MAX_NUMBER_STEPS} steps between min and max.`,
  });

export const formFieldSchema = z.union([
  formChoiceFieldSchema,
  formMultiChoiceFieldSchema,
  formNumberFieldSchema,
]);
export type FormField = z.infer<typeof formFieldSchema>;
export type FormNumberField = z.infer<typeof formNumberFieldSchema>;

export const formBlockSchema = z.object({
  type: z.literal("form"),
  title: z.string().trim().min(1).max(80).optional(),
  fields: z
    .array(formFieldSchema)
    .min(1)
    .max(MAX_FIELDS)
    // The answer message names each field by its label.
    .refine((fields) => distinct(fields.map((f) => f.label)), {
      message: "Field labels must be different from each other.",
    }),
  submitLabel: z.string().trim().min(1).max(30).optional(),
});
export type FormBlock = z.infer<typeof formBlockSchema>;
