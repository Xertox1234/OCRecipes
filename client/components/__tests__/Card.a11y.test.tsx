// @vitest-environment jsdom
/**
 * Card.tsx forwards the hiding-prop pair (todo
 * P3-2026-09-14-card-lacks-a11y-passthrough-props): `accessibilityElementsHidden`
 * and `importantForAccessibility`, matching ProductChip's existing
 * `importantForAccessibility` passthrough. This lets a host screen hide a
 * <Card> subtree from screen readers (e.g. while a confirmation sheet is
 * presented, via `useConfirmationModal`'s `behindContentA11yProps`) without a
 * wrapper `View`.
 *
 * Per docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-
 * hiding-2026-07-03.md's 2026-08-17 exception, the EXPLICIT hiding pair
 * (`accessibilityElementsHidden` / `importantForAccessibility="no-hide-
 * descendants"`) IS mapped to `aria-hidden` by the test mocks, so — unlike
 * the general `accessible={true/false}` case — this is assertable here. Each
 * hidden-case assertion is paired with a default-case (rule 1a) so the test
 * can't pass merely because the query matches nothing.
 */
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { Card } from "../Card";

describe("Card a11y hiding passthrough", () => {
  describe("plain View root (no onPress)", () => {
    it("marks the root aria-hidden when the hiding props are set", () => {
      const { container } = renderComponent(
        <Card
          title="Recipe"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />,
      );

      expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    });

    // The mock's `ariaHiddenProps` ORs the pair (either prop alone maps to
    // aria-hidden), so the "both together" test above can't tell "both
    // forwarded" from "only one forwarded" — a future regression that drops
    // just one of Card's two forwards would stay green there. These two
    // single-prop rows exist to close that gap by asserting each prop's
    // forward in isolation (see the forwards at Card.tsx's plain-View
    // return).
    it("marks the root aria-hidden with only accessibilityElementsHidden set", () => {
      const { container } = renderComponent(
        <Card title="Recipe" accessibilityElementsHidden />,
      );

      expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    });

    it("marks the root aria-hidden with only importantForAccessibility set", () => {
      const { container } = renderComponent(
        <Card title="Recipe" importantForAccessibility="no-hide-descendants" />,
      );

      expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    });

    it("does not mark the root aria-hidden by default", () => {
      const { container } = renderComponent(<Card title="Recipe" />);

      expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe(
        null,
      );
    });
  });

  describe("Pressable root (onPress set)", () => {
    it("excludes the pressable root from the accessibility tree when hidden", () => {
      renderComponent(
        <Card
          title="Recipe"
          onPress={() => {}}
          accessibilityLabel="Open recipe"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />,
      );

      expect(screen.queryByRole("button")).toBeNull();
    });

    // Same OR-gap as the View root's single-prop rows above — see that
    // comment.
    it("excludes the pressable root with only accessibilityElementsHidden set", () => {
      renderComponent(
        <Card
          title="Recipe"
          onPress={() => {}}
          accessibilityLabel="Open recipe"
          accessibilityElementsHidden
        />,
      );

      expect(screen.queryByRole("button")).toBeNull();
    });

    it("excludes the pressable root with only importantForAccessibility set", () => {
      renderComponent(
        <Card
          title="Recipe"
          onPress={() => {}}
          accessibilityLabel="Open recipe"
          importantForAccessibility="no-hide-descendants"
        />,
      );

      expect(screen.queryByRole("button")).toBeNull();
    });

    it("keeps the pressable root in the accessibility tree by default", () => {
      renderComponent(
        <Card
          title="Recipe"
          onPress={() => {}}
          accessibilityLabel="Open recipe"
        />,
      );

      expect(screen.getByRole("button", { name: "Open recipe" })).toBeTruthy();
    });
  });
});
