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

const label = z.string().trim().min(1).max(120);
const option = z.string().trim().min(1).max(60);

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
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
    /** Where the stepper starts. */
    value: z.number().finite(),
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
