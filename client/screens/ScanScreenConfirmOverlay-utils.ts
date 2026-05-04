/**
 * Pure utility functions for the returnAfterLog/confirmCard overlay flow in ScanScreen.
 * Extracted to enable Vitest unit testing without React Native imports.
 */

/** Shape of the confirm card state held in ScanScreen */
export type ConfirmCardState = {
  barcode: string;
  name: string;
  calories: number | null;
  isLoading: boolean;
  isLogging: boolean;
  isError: boolean;
};

/** Shape of the product API response from /api/nutrition/barcode/:barcode */
export type ProductInfoResponse = {
  productName?: string;
  calories?: number;
};

/** Payload sent to POST /api/scanned-items */
export type ScannedItemPayload = {
  barcode: string;
  productName: string;
  sourceType: "scan";
  calories: string | undefined;
};

/**
 * Build the initial loading state for the confirm overlay when SESSION_COMPLETE
 * fires with returnAfterLog=true.
 */
export function buildLoadingConfirmCard(barcode: string): ConfirmCardState {
  return {
    barcode,
    name: "Loading...",
    calories: null,
    isLoading: true,
    isLogging: false,
    isError: false,
  };
}

/**
 * Build the loaded confirm card state after a successful product info fetch.
 */
export function buildLoadedConfirmCard(
  barcode: string,
  data: ProductInfoResponse,
): ConfirmCardState {
  return {
    barcode,
    name: data.productName ?? "Food item",
    calories: data.calories ?? null,
    isLoading: false,
    isLogging: false,
    isError: false,
  };
}

/**
 * Build the error confirm card state when the product info fetch fails.
 * isError=true disables Log It and shows "Nutrition data unavailable".
 */
export function buildFetchErrorConfirmCard(barcode: string): ConfirmCardState {
  return {
    barcode,
    name: "Food item",
    calories: null,
    isLoading: false,
    isLogging: false,
    isError: true,
  };
}

/**
 * Build the POST payload for logging a scanned item via the confirm overlay.
 */
export function buildScannedItemPayload(
  card: ConfirmCardState,
): ScannedItemPayload {
  return {
    barcode: card.barcode,
    productName: card.name,
    sourceType: "scan",
    calories: card.calories != null ? card.calories.toString() : undefined,
  };
}

/**
 * Build the success toast message shown after a successful Log It action.
 */
export function buildSuccessToastMessage(card: ConfirmCardState): string {
  return `Logged! ${card.name}${card.calories ? ` · ${card.calories} cal` : ""}`;
}

/**
 * Returns true when Log It should be enabled: not loading, not currently
 * logging, and no fetch error.
 */
export function canLog(card: ConfirmCardState): boolean {
  return !card.isLoading && !card.isLogging && !card.isError;
}
