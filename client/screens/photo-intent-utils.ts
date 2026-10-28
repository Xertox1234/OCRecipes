import { photoIntents } from "@shared/constants/preparation";
import type { PhotoIntent } from "@shared/constants/preparation";
import type { PremiumFeatures } from "@shared/types/premium";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/** Minimal shape the lock predicate needs from an intent option. */
type LockableIntentOption = {
  intent: PhotoIntent | "cook";
  requiresPremium?: boolean;
};

/**
 * Whether a premium-gated intent option is locked for the current user.
 *
 * Each premium intent gates on its OWN feature flag. In particular "menu" must
 * gate on `menuScanner` — NOT the recipe-generation quota — otherwise a premium
 * user who has exhausted their daily recipe generations (isRecipeAvailable =
 * false) is wrongly locked out of menu scanning, a feature they own.
 */
export function isIntentOptionLocked(
  option: LockableIntentOption,
  features: Pick<PremiumFeatures, "cookAndTrack" | "menuScanner">,
  isRecipeAvailable: boolean,
): boolean {
  if (!option.requiresPremium) return false;
  if (option.intent === "cook") return !features.cookAndTrack;
  if (option.intent === "menu") return !features.menuScanner;
  // recipe: gate on recipe-generation availability (quota-aware)
  return !isRecipeAvailable;
}

/** An intent the Scan screen can carry through capture. */
export type ScanIntent = PhotoIntent | "cook";

const SCAN_INTENTS: readonly string[] = [...photoIntents, "cook"];

/**
 * Runtime guard for `Scan`'s `intent` param. The type is not trustworthy at the
 * boundary: CoachChat forwards model-produced params with a bare cast, and a
 * repeated query key arrives as an array.
 */
export function isScanIntent(value: unknown): value is ScanIntent {
  return typeof value === "string" && SCAN_INTENTS.includes(value);
}

/**
 * Whether an intent is locked for the current user. Same rule as the
 * PhotoIntent screen's option lock, for callers that only have the intent.
 */
export function isScanIntentLocked(
  intent: ScanIntent,
  features: Pick<PremiumFeatures, "cookAndTrack" | "menuScanner">,
  isRecipeAvailable: boolean,
): boolean {
  const requiresPremium =
    intent === "recipe" || intent === "menu" || intent === "cook";
  return isIntentOptionLocked(
    { intent, requiresPremium },
    features,
    isRecipeAvailable,
  );
}

export type PhotoIntentDestination =
  | { screen: "Scan"; params: RootStackParamList["Scan"] }
  | { screen: "CookSessionCapture"; params: { initialPhotoUri: string } }
  | { screen: "LabelAnalysis"; params: { imageUri: string } }
  | { screen: "MenuScanResult"; params: { imageUri: string } }
  | {
      screen: "PhotoAnalysis";
      params: { imageUri: string; intent: PhotoIntent };
    };

/**
 * Where a picked intent goes. Without a photo it goes to Scan CARRYING the
 * choice (label reuses Scan's label mode) so it survives capture instead of
 * being dropped for auto-classification.
 */
export function getPhotoIntentDestination(
  intent: ScanIntent,
  imageUri: string | undefined,
): PhotoIntentDestination {
  if (!imageUri) {
    return {
      screen: "Scan",
      params: intent === "label" ? { mode: "label" } : { intent },
    };
  }
  if (intent === "cook") {
    return {
      screen: "CookSessionCapture",
      params: { initialPhotoUri: imageUri },
    };
  }
  if (intent === "label") {
    return { screen: "LabelAnalysis", params: { imageUri } };
  }
  if (intent === "menu") {
    return { screen: "MenuScanResult", params: { imageUri } };
  }
  return { screen: "PhotoAnalysis", params: { imageUri, intent } };
}
