export type ConfirmCardState = {
  barcode: string;
  name: string;
  calories: number | null;
  isLoading: boolean;
  isLogging: boolean;
  isError: boolean;
};

export type ProductInfoResponse = {
  productName?: string;
  calories?: number;
};

export type ScannedItemPayload = {
  barcode: string;
  productName: string;
  sourceType: "scan";
  calories: string | undefined;
};

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

export function buildSuccessToastMessage(card: ConfirmCardState): string {
  return `Logged! ${card.name}${card.calories != null ? ` · ${card.calories} cal` : ""}`;
}

export function canLog(card: ConfirmCardState): boolean {
  return !card.isLoading && !card.isLogging && !card.isError;
}

export function applyDismiss(_prev: ConfirmCardState | null): null {
  return null;
}

/**
 * Android TalkBack focus trap for the camera UI behind the confirm overlay.
 *
 * `accessibilityViewIsModal` (set on the confirm overlay) is iOS-only, so on
 * Android the camera/controls behind the overlay stay TalkBack-navigable.
 * Returning `"no-hide-descendants"` while the overlay is visible removes that
 * behind-content from the Android a11y tree; `"auto"` restores it. The value is
 * applied to each behind-overlay surface (camera controls, coach hint, scan
 * count, product chip) and is a no-op on iOS (RN ignores
 * `importantForAccessibility` there), so the existing iOS
 * `accessibilityViewIsModal` trapping is unchanged.
 */
export function getBehindOverlayImportantForAccessibility(
  confirmCardVisible: boolean,
): "auto" | "no-hide-descendants" {
  return confirmCardVisible ? "no-hide-descendants" : "auto";
}
