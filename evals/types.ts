import { z } from "zod";
import type { CoachContext } from "../server/services/nutrition-coach";

// Widened to string for generic runner; per-service aliases below for type docs.
export type RubricDimension = string;

// Coach-specific dimensions (backward compat)
export type CoachDimension =
  | "safety"
  | "accuracy"
  | "helpfulness"
  | "personalization"
  | "tone";
export const ALL_COACH_DIMENSIONS: CoachDimension[] = [
  "safety",
  "accuracy",
  "helpfulness",
  "personalization",
  "tone",
];
// Keep ALL_DIMENSIONS pointing at coach set so existing runner.ts compiles unchanged
export const ALL_DIMENSIONS = ALL_COACH_DIMENSIONS;

// Per-service dimension types
export type RecipeChatDimension =
  | "relevance"
  | "recipe_quality"
  | "dietary_compliance"
  | "safety"
  | "tone";
export const ALL_RECIPE_CHAT_DIMENSIONS: RecipeChatDimension[] = [
  "relevance",
  "recipe_quality",
  "dietary_compliance",
  "safety",
  "tone",
];

export type MealSuggestionDimension =
  | "macro_accuracy"
  | "dietary_compliance"
  | "variety"
  | "helpfulness";
export const ALL_MEAL_SUGGESTION_DIMENSIONS: MealSuggestionDimension[] = [
  "macro_accuracy",
  "dietary_compliance",
  "variety",
  "helpfulness",
];

export type RecipeGenerationDimension =
  | "ingredient_coherence"
  | "instruction_clarity"
  | "dietary_compliance"
  | "creativity";
export const ALL_RECIPE_GENERATION_DIMENSIONS: RecipeGenerationDimension[] = [
  "ingredient_coherence",
  "instruction_clarity",
  "dietary_compliance",
  "creativity",
];

export type PhotoAnalysisDimension =
  | "identification_accuracy"
  | "portion_plausibility"
  | "confidence_calibration";
export const ALL_PHOTO_ANALYSIS_DIMENSIONS: PhotoAnalysisDimension[] = [
  "identification_accuracy",
  "portion_plausibility",
  "confidence_calibration",
];

export interface EvalTestCase {
  id: string;
  category:
    | "safety"
    | "accuracy"
    | "helpfulness"
    | "personalization"
    | "edge-case"
    | "creativity";
  description: string;
  // Coach cases use userMessage + context at top level; other suites use input.
  userMessage?: string;
  context?: CoachContext;
  // Generic input for non-coach suites
  input?: unknown;
  assertions?: {
    mustNotContain?: string[];
    mustContain?: string[];
    mustNotRecommendBelow?: number; // coach only — evaluated by LLM judge
    macrosBudgetRespected?: boolean; // meal suggestions — checks suggestions vs remainingCalories
    suggestionCount?: number; // meal suggestions — checks array length
    mustHaveMinIngredients?: number; // recipe generation — checks ingredients array length
    mustHaveMinInstructions?: number; // recipe generation — checks instructions array length
    foodsMinLength?: number; // photo analysis — checks foods array is non-empty or has min items
    overallConfidenceMin?: number; // photo analysis — checks overallConfidence >= value
    overallConfidenceMax?: number; // photo analysis — checks overallConfidence <= value
  };
  scoreDimensions?: RubricDimension[];
}

/**
 * Zod schema for the coach-cases.json dataset. Matches the `EvalTestCase`
 * interface above. Parse with `evalTestCasesSchema.parse(...)` at load time
 * so bad test-case data (missing `userMessage`, wrong `category`, etc.)
 * fails the eval run loudly instead of silently producing nonsense scores.
 */
const macroGoalsSchema = z.object({
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

const coachContextSchema = z.object({
  goals: macroGoalsSchema.nullable(),
  todayIntake: macroGoalsSchema,
  dietaryProfile: z.object({
    dietType: z.string().nullable(),
    allergies: z.array(z.string()),
    dislikes: z.array(z.string()),
  }),
  screenContext: z.string().optional(),
  notebookSummary: z.string().optional(),
});

export const evalTestCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "safety",
    "accuracy",
    "helpfulness",
    "personalization",
    "edge-case",
    "creativity",
  ]),
  description: z.string(),
  userMessage: z.string().min(1),
  context: coachContextSchema,
  assertions: z
    .object({
      mustNotContain: z.array(z.string()).optional(),
      mustContain: z.array(z.string()).optional(),
      mustNotRecommendBelow: z.number().optional(),
      macrosBudgetRespected: z.boolean().optional(),
      suggestionCount: z.number().optional(),
      mustHaveMinIngredients: z.number().optional(),
      mustHaveMinInstructions: z.number().optional(),
      foodsMinLength: z.number().int().min(0).optional(),
      overallConfidenceMin: z.number().min(0).max(1).optional(),
      overallConfidenceMax: z.number().min(0).max(1).optional(),
    })
    .optional(),
  scoreDimensions: z.array(z.string()).optional(),
});

export const evalTestCasesSchema = z.array(evalTestCaseSchema);

export interface AssertionResult {
  passed: boolean;
  failures: string[];
}

export interface RubricScore {
  dimension: RubricDimension;
  score: number;
  reasoning: string;
}

export interface EvalCaseResult {
  testCaseId: string;
  category: EvalTestCase["category"];
  description: string;
  /** Formatted input summary produced by the suite's formatInput() callback */
  inputSummary: string;
  /** Serialised service output passed to the LLM judge */
  output: string;
  assertions: AssertionResult;
  rubricScores: RubricScore[];
  /**
   * Model identifier used by the LLM judge for this case. Persisted per-case
   * (not just per-run) so future multi-model comparisons — e.g., A/B rollouts
   * that route different cases to different judge models — retain provenance
   * at the case granularity required to reproduce or debug a specific score.
   */
  judgeModel: string;
  timestamp: string;
  latencyMs: number;
  wordCount: number;
}

/**
 * 95% bootstrap confidence interval for a dimension's mean score across cases.
 * Computed via percentile bootstrap (2.5% / 97.5% quantiles) over all
 * individual case scores (including multiple samples per case when
 * `samplesPerCase > 1`). Narrower interval = more confidence in the mean.
 */
export interface DimensionConfidenceInterval {
  mean: number;
  lower: number;
  upper: number;
  sampleSize: number;
}

export interface EvalRunResult {
  runId: string;
  timestamp: string;
  judgeModel: string;
  totalCases: number;
  /** Number of samples per test case (>1 enables sample-averaging) */
  samplesPerCase: number;
  assertionPassRate: number;
  dimensionAverages: Record<RubricDimension, number>;
  /** 95% percentile-bootstrap CIs per dimension across all case samples */
  dimensionConfidenceIntervals: Record<
    RubricDimension,
    DimensionConfidenceInterval
  >;
  weightedOverall: number;
  categoryBreakdown: Record<string, Record<RubricDimension, number>>;
  cases: EvalCaseResult[];
  lowestScoringCases: {
    testCaseId: string;
    dimension: RubricDimension;
    score: number;
    reasoning: string;
  }[];
}
