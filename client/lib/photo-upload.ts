import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import { tokenStorage } from "./token-storage";
import { getApiUrl } from "./query-client";
import { ApiError } from "./api-error";
import { compressImage, cleanupImage } from "./image-compression";
import type { PhotoIntent, FoodCategory } from "@shared/constants/preparation";
import type {
  PhotoIntentOrAuto,
  ContentType,
} from "@shared/constants/classification";

// Import shared types for use in this file, and re-export for consumers
import type { LabelAnalysisResponse } from "@shared/types/label-analysis";
import type { ImportedRecipeData } from "@shared/types/recipe-import";
import type {
  FrontLabelAnalysisResponse,
  FrontLabelConfirmResponse,
} from "@shared/types/front-label";

// Types matching server response
export interface FoodItem {
  name: string;
  quantity: string;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion?: string;
  nutrition: NutritionData | null;
  category?: FoodCategory;
}

export interface NutritionData {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  servingSize: string;
  source: "api-ninjas" | "usda" | "cache";
}

export interface PhotoAnalysisResponse {
  sessionId: string | null;
  intent: PhotoIntent | "auto";
  foods: FoodItem[];
  overallConfidence: number;
  needsFollowUp: boolean;
  followUpQuestions: string[];
  /** Present when intent is "auto" — the detected content type */
  contentType?: ContentType;
  /** Present when intent is "auto" — classification confidence */
  confidence?: number;
  /** Present when intent is "auto" — the intent resolved from classification */
  resolvedIntent?: PhotoIntent | null;
  /** Present when a barcode was detected in the image */
  barcode?: string | null;
}

export interface PhotoConfirmRequest {
  sessionId: string;
  foods: {
    name: string;
    quantity: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }[];
  mealType?: string;
  preparationMethods?: { name: string; method: string }[];
  analysisIntent?: PhotoIntent;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Upload aborted");
  error.name = "AbortError";
  throw error;
}

/**
 * Build an `ApiError` for a non-200 `uploadAsync` response, preserving the
 * machine-readable `code` from the standard error body (`{ error, code? }`) so
 * screens can branch on `err.code` for code-specific copy. The message keeps
 * the `Upload failed: <status>` shape and never leaks the raw server body to the
 * user (the screen renders static copy).
 */
function uploadError(status: number, body: string): ApiError {
  let code: string | undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { code?: unknown }).code === "string"
    ) {
      code = (parsed as { code: string }).code;
    }
  } catch {
    // Non-JSON error body — no machine-readable code to extract.
  }
  return new ApiError(`Upload failed: ${status}`, code);
}

/**
 * Upload a photo for AI analysis
 *
 * Uses multipart/form-data upload (25-30% faster than base64 in JSON)
 * Automatically compresses image to under 1MB before upload
 */
export async function uploadPhotoForAnalysis(
  uri: string,
  intent: PhotoIntentOrAuto = "log",
  signal?: AbortSignal,
): Promise<PhotoAnalysisResponse> {
  throwIfAborted(signal);
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }
  throwIfAborted(signal);

  let compressedUri: string | null = null;

  try {
    // Compress image before upload
    const compressed = await compressImage(uri);
    compressedUri = compressed.uri;
    throwIfAborted(signal);
    // Expo uploadAsync does not accept AbortSignal; this helper uses
    // cooperative checks before and after the native upload call.
    const uploadResult = await uploadAsync(
      `${getApiUrl()}/api/photos/analyze`,
      compressedUri,
      {
        httpMethod: "POST",
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: "photo",
        parameters: { intent },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    throwIfAborted(signal);

    if (uploadResult.status !== 200) {
      throw uploadError(uploadResult.status, uploadResult.body);
    }

    try {
      throwIfAborted(signal);
      return JSON.parse(uploadResult.body) as PhotoAnalysisResponse;
    } catch {
      throw new Error("Invalid response from server");
    }
  } finally {
    // Clean up compressed image
    if (compressedUri) {
      await cleanupImage(compressedUri);
    }
  }
}

/**
 * Look up nutrition for a single item by query string (e.g., "steamed broccoli 1 cup").
 * Uses the existing GET /api/nutrition/lookup endpoint.
 */
export async function lookupNutritionByPrep(
  query: string,
): Promise<NutritionData | null> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(
    `${getApiUrl()}/api/nutrition/lookup?name=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Nutrition lookup failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Submit a follow-up answer for an analysis session
 */
export async function submitFollowUp(
  sessionId: string,
  question: string,
  answer: string,
): Promise<PhotoAnalysisResponse> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(
    `${getApiUrl()}/api/photos/analyze/${sessionId}/followup`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question, answer }),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || `Follow-up failed: ${response.status}`,
      errorData.code,
    );
  }

  return response.json();
}

/**
 * Confirm analysis and save to daily log
 */
export async function confirmPhotoAnalysis(
  request: PhotoConfirmRequest,
): Promise<{ id: number; productName: string }> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(`${getApiUrl()}/api/photos/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || `Confirm failed: ${response.status}`,
      errorData.code,
    );
  }

  return response.json();
}
export type {
  LabelExtractionResult,
  LabelAnalysisResponse,
} from "@shared/types/label-analysis";

export interface RecipePhotoResult {
  title: string;
  description: string | null;
  ingredients: { name: string; quantity: string | null; unit: string | null }[];
  instructions: string | null;
  servings: number | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  cuisine: string | null;
  dietTags: string[];
  caloriesPerServing: number | null;
  proteinPerServing: number | null;
  carbsPerServing: number | null;
  fatPerServing: number | null;
  confidence: number;
}

/**
 * Upload a photo for nutrition label analysis.
 * Higher compression settings than food photos for text readability.
 */
export async function uploadLabelForAnalysis(
  uri: string,
  barcode?: string,
): Promise<LabelAnalysisResponse> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const compressed = await compressImage(uri, {
    maxWidth: 1536,
    maxHeight: 1536,
    quality: 0.85,
    targetSizeKB: 4500, // Allow larger for label text readability
  });

  try {
    const parameters: Record<string, string> = {};
    if (barcode) parameters.barcode = barcode;

    const uploadResult = await uploadAsync(
      `${getApiUrl()}/api/photos/analyze-label`,
      compressed.uri,
      {
        httpMethod: "POST",
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: "photo",
        parameters,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (uploadResult.status !== 200) {
      throw uploadError(uploadResult.status, uploadResult.body);
    }

    return JSON.parse(uploadResult.body) as LabelAnalysisResponse;
  } finally {
    await cleanupImage(compressed.uri);
  }
}

/**
 * Confirm label analysis and save to daily log
 */
export async function confirmLabelAnalysis(
  sessionId: string,
  servingsConsumed: number,
  mealType?: string,
): Promise<{ id: number; productName: string }> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(`${getApiUrl()}/api/photos/confirm-label`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sessionId, servingsConsumed, mealType }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || `Confirm failed: ${response.status}`,
      errorData.code,
    );
  }

  return response.json();
}

/**
 * Upload a photo of a recipe (cookbook, recipe card, screenshot) for AI extraction.
 * Uses same high-quality compression as label scanning for text readability.
 */
export async function uploadRecipePhotoForAnalysis(
  uri: string,
): Promise<RecipePhotoResult> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const compressed = await compressImage(uri, {
    maxWidth: 1536,
    maxHeight: 1536,
    quality: 0.85,
    targetSizeKB: 4500,
  });

  try {
    const uploadResult = await uploadAsync(
      `${getApiUrl()}/api/photos/analyze-recipe`,
      compressed.uri,
      {
        httpMethod: "POST",
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: "photo",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (uploadResult.status !== 200) {
      throw uploadError(uploadResult.status, uploadResult.body);
    }

    return JSON.parse(uploadResult.body) as RecipePhotoResult;
  } finally {
    await cleanupImage(compressed.uri);
  }
}

/**
 * Send pasted recipe text for AI structuring. Plain JSON POST (not a file
 * upload like uploadRecipePhotoForAnalysis) — there's no image, just text.
 * Not premium-gated server-side (see server/routes/photos.ts).
 */
export async function uploadRecipeTextForAnalysis(
  text: string,
): Promise<RecipePhotoResult> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(`${getApiUrl()}/api/photos/structure-recipe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ pageTexts: [text] }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || `Structure failed: ${response.status}`,
      errorData.code,
    );
  }

  return response.json();
}

/**
 * Convert a RecipePhotoResult into ImportedRecipeData for RecipeCreateScreen prefill.
 */
export function mapPhotoResultToImportedRecipeData(
  result: RecipePhotoResult,
): ImportedRecipeData {
  return {
    title: result.title,
    description: result.description,
    servings: result.servings,
    prepTimeMinutes: result.prepTimeMinutes,
    cookTimeMinutes: result.cookTimeMinutes,
    cuisine: result.cuisine,
    dietTags: result.dietTags,
    ingredients: result.ingredients,
    instructions: result.instructions
      ? result.instructions.split(/\n/).filter((s) => s.trim().length > 0)
      : null,
    imageUrl: null,
    caloriesPerServing: result.caloriesPerServing?.toString() ?? null,
    proteinPerServing: result.proteinPerServing?.toString() ?? null,
    carbsPerServing: result.carbsPerServing?.toString() ?? null,
    fatPerServing: result.fatPerServing?.toString() ?? null,
    sourceUrl: "photo_import",
  };
}

/**
 * Convert a RecipePhotoResult (from pasted-text extraction) into
 * ImportedRecipeData for RecipeCreateScreen prefill. Same transforms as
 * mapPhotoResultToImportedRecipeData — only the sourceUrl sentinel differs.
 */
export function mapTextResultToImportedRecipeData(
  result: RecipePhotoResult,
): ImportedRecipeData {
  return {
    title: result.title,
    description: result.description,
    servings: result.servings,
    prepTimeMinutes: result.prepTimeMinutes,
    cookTimeMinutes: result.cookTimeMinutes,
    cuisine: result.cuisine,
    dietTags: result.dietTags,
    ingredients: result.ingredients,
    instructions: result.instructions
      ? result.instructions.split(/\n/).filter((s) => s.trim().length > 0)
      : null,
    imageUrl: null,
    caloriesPerServing: result.caloriesPerServing?.toString() ?? null,
    proteinPerServing: result.proteinPerServing?.toString() ?? null,
    carbsPerServing: result.carbsPerServing?.toString() ?? null,
    fatPerServing: result.fatPerServing?.toString() ?? null,
    sourceUrl: "text_import",
  };
}

/**
 * Calculate total nutrition from food items
 */
export function calculateTotals(foods: FoodItem[]): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} {
  return foods.reduce(
    (acc, food) => {
      if (food.nutrition) {
        return {
          calories: acc.calories + food.nutrition.calories,
          protein: acc.protein + food.nutrition.protein,
          carbs: acc.carbs + food.nutrition.carbs,
          fat: acc.fat + food.nutrition.fat,
        };
      }
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/**
 * Upload a front-of-package photo for extraction.
 * Smaller compression than back-label (1024px, 80% quality) since front text is larger.
 */
export async function uploadFrontLabelPhoto(
  uri: string,
  barcode: string,
): Promise<FrontLabelAnalysisResponse> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const compressed = await compressImage(uri, {
    maxWidth: 1024,
    maxHeight: 1024,
    quality: 0.8,
    targetSizeKB: 3000,
  });

  try {
    const uploadResult = await uploadAsync(
      `${getApiUrl()}/api/verification/front-label`,
      compressed.uri,
      {
        httpMethod: "POST",
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: "photo",
        parameters: { barcode },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (uploadResult.status !== 200) {
      throw uploadError(uploadResult.status, uploadResult.body);
    }

    return JSON.parse(uploadResult.body) as FrontLabelAnalysisResponse;
  } finally {
    await cleanupImage(compressed.uri);
  }
}

/**
 * Confirm front-label data and store on the barcode verification record.
 */
export async function confirmFrontLabel(
  sessionId: string,
  barcode: string,
): Promise<FrontLabelConfirmResponse> {
  const token = await tokenStorage.get();
  if (!token) {
    throw new Error("Not authenticated");
  }

  const response = await fetch(
    `${getApiUrl()}/api/verification/front-label/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId, barcode }),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || `Confirm failed: ${response.status}`,
      errorData.code,
    );
  }

  return response.json();
}
