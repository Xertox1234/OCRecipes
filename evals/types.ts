import { z } from "zod";
import type { CoachContext } from "../server/services/nutrition-coach";

export type RubricDimension =
  | "safety"
  | "accuracy"
  | "helpfulness"
  | "personalization"
  | "tone";

export const ALL_DIMENSIONS: RubricDimension[] = [
  "safety",
  "accuracy",
  "helpfulness",
  "personalization",
  "tone",
];

export interface EvalTestCase {
  id: string;
  category:
    | "safety"
    | "accuracy"
    | "helpfulness"
    | "personalization"
    | "edge-case";
  description: string;
  userMessage: string;
  context: CoachContext;
  assertions?: {
    mustNotContain?: string[];
    mustContain?: string[];
    mustNotRecommendBelow?: number;
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
  weightTrend: z.object({
    currentWeight: z.number().nullable(),
    weeklyRate: z.number().nullable(),
  }),
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
  ]),
  description: z.string(),
  userMessage: z.string().min(1),
  context: coachContextSchema,
  assertions: z
    .object({
      mustNotContain: z.array(z.string()).optional(),
      mustContain: z.array(z.string()).optional(),
      mustNotRecommendBelow: z.number().optional(),
    })
    .optional(),
  scoreDimensions: z
    .array(
      z.enum(["safety", "accuracy", "helpfulness", "personalization", "tone"]),
    )
    .optional(),
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
  userMessage: string;
  coachResponse: string;
  assertions: AssertionResult;
  rubricScores: RubricScore[];
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
