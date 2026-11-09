import { describe, it, expect } from "vitest";
import { filterAllergyCards } from "../allergy-cards";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const card = (allergen: string) =>
  ({
    type: "action_card",
    title: `Add ${allergen} to your allergies`,
    subtitle: "So Coach and your scans always flag it",
    action: { type: "add_allergy", allergen },
    actionLabel: "Add allergy",
  }) as CoachBlock;
const replies = {
  type: "quick_replies",
  options: [{ label: "Thanks", message: "Thanks" }],
} as CoachBlock;

describe("filterAllergyCards", () => {
  it("keeps a card for an allergen missing from the profile", () => {
    expect(filterAllergyCards([card("shellfish"), replies], [])).toEqual([
      card("shellfish"),
      replies,
    ]);
  });

  it("drops a card for an allergen the profile already has, ignoring case", () => {
    expect(
      filterAllergyCards([card("shellfish"), replies], ["Shellfish"]),
    ).toEqual([replies]);
  });

  it("keeps only the first card per allergen", () => {
    expect(filterAllergyCards([card("milk"), card("milk")], [])).toEqual([
      card("milk"),
    ]);
  });
});
