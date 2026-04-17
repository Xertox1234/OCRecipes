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

export interface EvalRunResult {
  runId: string;
  timestamp: string;
  judgeModel: string;
  totalCases: number;
  assertionPassRate: number;
  dimensionAverages: Record<RubricDimension, number>;
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
