import type { ScanFlag } from "@shared/types/scan-flags";
import { pickTopSafetyFlag } from "@shared/types/scan-flags";

export type ConfirmCardState = {
  barcode: string;
  name: string;
  calories: number | null;
  isLoading: boolean;
  isLogging: boolean;
  isError: boolean;
  safetyFlag?: ScanFlag;
};

export type ProductInfoResponse = {
  productName?: string;
  calories?: number;
  flags?: ScanFlag[];
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
    safetyFlag: pickTopSafetyFlag(Array.isArray(data.flags) ? data.flags : []),
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

type OverlayA11yValue = "auto" | "no-hide-descendants";

export type ScanOverlayA11y = {
  /** `importantForAccessibility` for the static camera UI behind both overlays. */
  staticUI: OverlayA11yValue;
  /** `importantForAccessibility` for ProductChip, which is itself an overlay. */
  productChip: OverlayA11yValue;
};

/**
 * Android TalkBack focus trap for ScanScreen's overlays.
 *
 * `accessibilityViewIsModal` (set on the confirm overlay AND on ProductChip)
 * traps focus on iOS only — it is a no-op on Android, where the camera UI behind
 * an active overlay would otherwise stay TalkBack-navigable. Mirror that
 * trapping on Android with `importantForAccessibility` (`"no-hide-descendants"`
 * removes a subtree from the a11y tree, `"auto"` restores it). Two values are
 * returned because the surfaces nest differently:
 *  - `staticUI` (top bar, coach hint, controls, scan count) sits behind BOTH
 *    overlays, so it hides whenever EITHER is active.
 *  - `productChip` is itself an overlay, so it hides only when the confirm card
 *    supersedes it; otherwise it must stay reachable as the active overlay.
 *
 * No-op on iOS (RN ignores `importantForAccessibility` there), so the existing
 * iOS `accessibilityViewIsModal` trapping is unchanged.
 */
export function getScanOverlayA11y(
  confirmCardVisible: boolean,
  productChipVisible: boolean,
): ScanOverlayA11y {
  const hide = (shouldHide: boolean): OverlayA11yValue =>
    shouldHide ? "no-hide-descendants" : "auto";
  return {
    staticUI: hide(confirmCardVisible || productChipVisible),
    productChip: hide(confirmCardVisible),
  };
}
