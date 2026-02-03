/**
 * Shared API response types for the NutriScan client.
 * These types represent the JSON responses from the server API.
 *
 * Note: Dates come as ISO strings over JSON, not Date objects.
 */

/**
 * API response type for scanned items.
 * Used in history list, item detail, and dashboard views.
 */
export type ScannedItemResponse = {
  id: number;
  productName: string;
  brandName?: string | null;
  servingSize?: string | null;
  calories?: string | null;
  protein?: string | null;
  carbs?: string | null;
  fat?: string | null;
  fiber?: string | null;
  sugar?: string | null;
  sodium?: string | null;
  imageUrl?: string | null;
  scannedAt: string; // ISO string
};

/**
 * Generic paginated response wrapper for list endpoints.
 */
export type PaginatedResponse<T> = {
  items: T[];
  total: number;
};

/**
 * Daily summary response from /api/daily-summary.
 * Contains aggregated nutrition totals for a specific day.
 */
export type DailySummaryResponse = {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  itemCount: number;
};
