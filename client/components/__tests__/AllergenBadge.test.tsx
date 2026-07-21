// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
// Repo convention: renderComponent wraps RTL-for-web + QueryClient (jsdom).
// Do NOT import @testing-library/react-native — the repo does not use it.
import { renderComponent } from "../../../test/utils/render-component";
import { AllergenBadge } from "@/components/AllergenBadge";

describe("AllergenBadge", () => {
  it("renders the allergen label", () => {
    const { getByText } = renderComponent(
      <AllergenBadge allergenLabel="Peanuts" severity="severe" />,
    );
    expect(getByText("Peanuts")).toBeTruthy();
  });

  it("composes a severe-severity accessibility label", () => {
    const { getByLabelText } = renderComponent(
      <AllergenBadge allergenLabel="Peanuts" severity="severe" />,
    );
    expect(getByLabelText("Severe allergen: Peanuts")).toBeTruthy();
  });

  it("composes a moderate-severity accessibility label", () => {
    const { getByLabelText } = renderComponent(
      <AllergenBadge allergenLabel="Dairy/Milk" severity="moderate" />,
    );
    expect(getByLabelText("Allergen: Dairy/Milk")).toBeTruthy();
  });

  it("composes a mild-severity accessibility label", () => {
    const { getByLabelText } = renderComponent(
      <AllergenBadge allergenLabel="Soy" severity="mild" />,
    );
    expect(getByLabelText("Contains: Soy")).toBeTruthy();
  });

  // The container also sets `accessible={true}` (mirroring the ScanFlagBadge
  // fix) so VoiceOver/TalkBack announce the composed label as one unit
  // instead of drilling into the icon + text children individually. jsdom
  // cannot model this — react-native's `accessible` prop never reaches the
  // rendered DOM for either `true` or `false` (verified empirically: no
  // `accessible` attribute appears regardless of value), so there is no
  // in-harness way to assert the grouping itself. The exact-label-composition
  // tests above are the harness-appropriate proxy per
  // docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md;
  // verify the actual grouping on-device (TalkBack/VoiceOver).
});
