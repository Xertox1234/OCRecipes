import { describe, it, expect } from "vitest";
import { DISCOVERY_CARDS } from "../discovery-cards-config";
import { HOME_ACTIONS } from "../action-config";

describe("discovery-cards-config", () => {
  it("every card id maps to an existing HOME_ACTION", () => {
    const actionIds = new Set(HOME_ACTIONS.map((a) => a.id));
    for (const card of DISCOVERY_CARDS) {
      expect(
        actionIds.has(card.id),
        `card.id "${card.id}" not found in HOME_ACTIONS`,
      ).toBe(true);
    }
  });

  it("has no duplicate card ids", () => {
    const ids = DISCOVERY_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every card has non-empty required fields", () => {
    for (const card of DISCOVERY_CARDS) {
      expect(
        card.eyebrow.length,
        `eyebrow empty for card "${card.id}"`,
      ).toBeGreaterThan(0);
      expect(
        card.headline.length,
        `headline empty for card "${card.id}"`,
      ).toBeGreaterThan(0);
      expect(
        card.subtitle.length,
        `subtitle empty for card "${card.id}"`,
      ).toBeGreaterThan(0);
      expect(
        card.emoji.length,
        `emoji empty for card "${card.id}"`,
      ).toBeGreaterThan(0);
      expect(
        card.ctaLabel.length,
        `ctaLabel empty for card "${card.id}"`,
      ).toBeGreaterThan(0);
    }
  });
});
