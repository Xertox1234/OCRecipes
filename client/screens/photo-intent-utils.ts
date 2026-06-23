import type { PhotoIntent } from "@shared/constants/preparation";
import type { PremiumFeatures } from "@shared/types/premium";

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
