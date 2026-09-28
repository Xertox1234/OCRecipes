// shared/schemas/recipe-finder.ts
// Recipe finder (spec 2026-09-28): server-built list/question blocks shared by
// RecipeChef (message metadata `finder`) and Coach Pro (a `blocks[]` entry).
import { z } from "zod";

/** Max rows in one finder list (D3: 3–5 close matches). */
export const FINDER_MAX_ITEMS = 5;

export const recipeQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  cuisine: z.string().trim().min(1).max(50).optional(),
  diet: z.string().trim().min(1).max(50).optional(),
  maxPrepTime: z.number().int().positive().max(1440).optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
});
export type RecipeQuery = z.infer<typeof recipeQuerySchema>;

export const finderItemSchema = z.object({
  id: z.number().int().positive(),
  source: z.enum(["community", "spoonacular"]),
  title: z.string().min(1).max(200),
  imageUrl: z.string().nullable(),
  readyInMinutes: z.number().int().positive().nullable(),
  calories: z.number().nonnegative().nullable(),
});
export type FinderItem = z.infer<typeof finderItemSchema>;

export const finderButtonSchema = z.enum([
  "search_online",
  "generate",
  "none_of_these",
]);
export type FinderButton = z.infer<typeof finderButtonSchema>;

export const finderFlowSchema = z.object({
  /** New per finder message: only the latest message's buttons are live. */
  flowId: z.string().uuid(),
  stage: z.enum(["results", "clarifying"]),
  /** The request text so far (original + refinements + answers). */
  request: z.string().min(1).max(2000),
  query: recipeQuerySchema,
  /** 0 before the clarifying round, 1 after it (spec §4: one round max). */
  round: z.union([z.literal(0), z.literal(1)]),
  /** "community:12" / "spoonacular:715538" already shown in this flow. */
  shownIds: z.array(z.string().max(40)).max(40),
});
export type FinderFlow = z.infer<typeof finderFlowSchema>;

export const clarifyingQuestionSchema = z.object({
  question: z.string().trim().min(1).max(160),
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(5),
});
export type ClarifyingQuestion = z.infer<typeof clarifyingQuestionSchema>;

export const finderNoticeSchema = z.enum([
  "no_matches",
  "unavailable",
  "generate_limit",
  "generate_premium",
]);
export type FinderNotice = z.infer<typeof finderNoticeSchema>;

export const recipeResultsBlockSchema = z.object({
  type: z.literal("recipe_results"),
  source: z.enum(["community", "spoonacular"]),
  items: z.array(finderItemSchema).max(FINDER_MAX_ITEMS),
  actions: z.array(finderButtonSchema).max(3),
  notice: finderNoticeSchema.nullable(),
  flow: finderFlowSchema,
});
export type RecipeResultsBlock = z.infer<typeof recipeResultsBlockSchema>;

export const recipeQuestionsBlockSchema = z.object({
  type: z.literal("recipe_questions"),
  questions: z.array(clarifyingQuestionSchema).min(1).max(3),
  flow: finderFlowSchema,
});
export type RecipeQuestionsBlock = z.infer<typeof recipeQuestionsBlockSchema>;

export const finderBlockSchema = z.discriminatedUnion("type", [
  recipeResultsBlockSchema,
  recipeQuestionsBlockSchema,
]);
export type FinderBlock = z.infer<typeof finderBlockSchema>;

export function isFinderBlockType(type: unknown): type is FinderBlock["type"] {
  return type === "recipe_results" || type === "recipe_questions";
}

export const finderAnswerSchema = z.object({
  question: z.string().trim().min(1).max(160),
  answer: z.string().trim().min(1).max(200),
});
export type FinderAnswer = z.infer<typeof finderAnswerSchema>;

/** Button taps, sent as the send-message body's `finderAction` (R2). */
export const finderActionSchema = z
  .object({
    type: z.enum(["search_online", "generate", "none_of_these", "answers"]),
    flowId: z.string().uuid(),
    answers: z.array(finderAnswerSchema).min(1).max(3).optional(),
  })
  .refine((a) => a.type !== "answers" || a.answers !== undefined, {
    message: "answers is required for an answers action",
    path: ["answers"],
  });
export type FinderAction = z.infer<typeof finderActionSchema>;

/** RecipeChef assistant-message metadata for a finder step (R2). */
export const recipeFinderMetadataSchema = z.object({
  metadataVersion: z.literal(1),
  finder: finderBlockSchema,
});
export type RecipeFinderMetadata = z.infer<typeof recipeFinderMetadataSchema>;
