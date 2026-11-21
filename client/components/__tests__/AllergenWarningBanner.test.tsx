// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderComponent } from "../../../test/utils/render-component";
import { AllergenWarningBanner } from "../AllergenWarningBanner";
import { Colors } from "@/constants/theme";
import type { AllergenMatch } from "@shared/constants/allergens";

const match = (severity: AllergenMatch["severity"]): AllergenMatch => ({
  allergenId: "peanuts",
  severity,
  ingredientName: "peanut butter",
  matchedKeyword: "peanut",
  isDerived: false,
  isPossible: false,
});

const messageColour = () => {
  const node = screen.getByText(/contains your allergens/i);
  return (node as HTMLElement).style.color;
};

const toRgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

// Accessibility audit 2026-11-21 H2: the banner message used the severity's
// fill tone as TEXT — light `warning` (2.51:1) and `info` (2.90:1) on cream.
describe("AllergenWarningBanner message colour", () => {
  it.each([
    ["severe", Colors.light.badgeErrorText],
    ["moderate", Colors.light.badgeWarningText],
    ["mild", Colors.light.badgeInfoText],
  ] as const)("uses the AA text token for %s", (severity, expected) => {
    renderComponent(<AllergenWarningBanner matches={[match(severity)]} />);
    expect(messageColour()).toBe(toRgb(expected));
  });
});
