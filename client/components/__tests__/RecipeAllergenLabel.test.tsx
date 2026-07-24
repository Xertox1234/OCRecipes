// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
// Repo convention: renderComponent wraps RTL-for-web + QueryClient (jsdom).
// Do NOT import @testing-library/react-native — the repo does not use it.
import { renderComponent } from "../../../test/utils/render-component";
import { RecipeAllergenLabel } from "@/components/RecipeAllergenLabel";

describe("RecipeAllergenLabel", () => {
  it("shows the universal label for a nut recipe, regardless of the viewer's own allergies (this component takes no viewer-allergy input)", () => {
    const { getByText, container } = renderComponent(
      <RecipeAllergenLabel
        allergens={[{ id: "tree_nuts", viaDerived: false }]}
      />,
    );

    expect(getByText("Contains:")).toBeTruthy();
    expect(getByText("Tree Nuts")).toBeTruthy();
    // NOTE: for a single-allergen recipe at severity="mild", AllergenBadge's
    // OWN composed label ("Contains: Tree Nuts") is textually identical to
    // this component's container label — on-device the badge is fully
    // unlinked from the a11y tree (accessibilityElementsHidden +
    // importantForAccessibility="no-hide-descendants"), so only the
    // container's label is ever announced. jsdom's mock does not model that
    // hiding, so both the container AND the nested badge remain in the DOM
    // with the same aria-label, which would make `getByLabelText` throw on
    // ambiguity. `querySelector` returns matches in document order (parent
    // before descendant), so this reliably targets the outer container.
    const labelled = container.querySelector(
      '[aria-label="Contains: Tree Nuts"]',
    );
    expect(labelled).toBeTruthy();
    expect(labelled?.getAttribute("role")).toBe("text");
  });

  it("composes a multi-allergen container label in input order", () => {
    const { getByLabelText } = renderComponent(
      <RecipeAllergenLabel
        allergens={[
          { id: "peanuts", viaDerived: false },
          { id: "milk", viaDerived: true },
        ]}
      />,
    );

    expect(getByLabelText("Contains: Peanuts, Dairy/Milk")).toBeTruthy();
  });

  it("renders nothing for null allergens — never a false safe/allergen-free signal", () => {
    const { queryByText, container } = renderComponent(
      <RecipeAllergenLabel allergens={null} />,
    );

    expect(queryByText("Contains:")).toBeNull();
    expect(queryByText(/no allergens/i)).toBeNull();
    expect(queryByText(/allergen-free/i)).toBeNull();
    expect(queryByText(/safe/i)).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for undefined allergens", () => {
    const { queryByText, container } = renderComponent(
      <RecipeAllergenLabel allergens={undefined} />,
    );

    expect(queryByText("Contains:")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an empty allergens array", () => {
    const { queryByText, container } = renderComponent(
      <RecipeAllergenLabel allergens={[]} />,
    );

    expect(queryByText("Contains:")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  // The outer container also sets `accessible={true}` so VoiceOver/TalkBack
  // announce the composed label as one unit, and the inner row wrapping the
  // "Contains:" text + AllergenBadge chips is fully hidden from the a11y tree
  // (`accessible={false}` + `accessibilityElementsHidden` +
  // `importantForAccessibility="no-hide-descendants"`) to prevent a garbled
  // double-announcement through AllergenBadge's own announceable Text
  // descendants. jsdom cannot model either side of this (react-native's
  // `accessible` prop and the hiding props never reach the rendered DOM) —
  // see docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
  // The exact composed-label assertions above are the harness-appropriate
  // proxy; verify the real subtree collapse on-device (TalkBack/VoiceOver).
});
