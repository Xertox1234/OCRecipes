/**
 * Shared types for nutrition label analysis.
 * Used by both server (photo-analysis service) and client (photo-upload, LabelAnalysisScreen).
 */
export interface LabelExtractionResult {
  servingSize: string | null;
  servingsPerContainer: number | null;
  calories: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  transFat: number | null;
  cholesterol: number | null;
  sodium: number | null;
  totalCarbs: number | null;
  dietaryFiber: number | null;
  totalSugars: number | null;
  addedSugars: number | null;
  protein: number | null;
  vitaminD: number | null;
  calcium: number | null;
  iron: number | null;
  potassium: number | null;
  confidence: number;
  productName: string | null;
}

export interface LabelAnalysisResponse {
  sessionId: string;
  intent: "label";
  labelData: LabelExtractionResult;
  barcode?: string;
}
