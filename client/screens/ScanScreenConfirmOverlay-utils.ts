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
