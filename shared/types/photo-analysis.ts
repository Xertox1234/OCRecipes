/**
 * Shared types for photo analysis results.
 * Used by both server (photo-analysis service, storage/sessions) and
 * any future client consumers.
 */
import type { FoodCategory } from "../constants/preparation";

export interface FoodItem {
  name: string;
  quantity: string;
  /** The food as a nutrition database lists it ("bananas, raw"); the lookup uses it over `name`. */
  lookupName?: string;
  /** Estimated edible weight of the portion; absent when the model gave none or an invalid one. */
  grams?: number;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
  category?: FoodCategory;
  cuisine?: string;
}

export interface AnalysisResult {
  foods: FoodItem[];
  overallConfidence: number;
  followUpQuestions: string[];
}
