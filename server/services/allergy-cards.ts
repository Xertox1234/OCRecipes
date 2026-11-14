import type { CoachBlock } from "@shared/schemas/coach-blocks";

/**
 * An "Add X to your allergies" card is worth showing only for an allergen the
 * profile doesn't already list, and only once per reply. The model decides when
 * to offer one; this check stops a card for an allergy already on file.
 */
export function filterAllergyCards(
  blocks: CoachBlock[],
  profileAllergyNames: readonly string[],
): CoachBlock[] {
  const seen = new Set(profileAllergyNames.map((n) => n.trim().toLowerCase()));
  return blocks.filter((b) => {
    if (b.type !== "action_card" || b.action.type !== "add_allergy") {
      return true;
    }
    if (seen.has(b.action.allergen)) return false;
    seen.add(b.action.allergen);
    return true;
  });
}
