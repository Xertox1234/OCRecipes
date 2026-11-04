// @vitest-environment jsdom
/**
 * Regression coverage for todos/P2-2026-10-29-touch-targets-per-site-pass.md
 * (audit M-a11y-1): icon-only buttons rely on hitSlop={8} for a 44pt target,
 * but RN clips hitSlop to the parent's bounds (Android) and a slop that
 * reaches a neighbour steals its taps. These buttons must instead be a real
 * 44pt box (minWidth/minHeight 44) with no hitSlop.
 *
 * The shared react-native mock drops Pressable's `style`, so this file wraps
 * Pressable to capture its raw props, keyed by accessibilityLabel.
 */
import React from "react";
import { renderComponent } from "../../../test/utils/render-component";
import { ChatBubble } from "../ChatBubble";
import { ParsedFoodPreview } from "../ParsedFoodPreview";
import { ServingStepperChip } from "../recipe-detail/ServingStepperChip";

const { captured } = vi.hoisted(() => ({
  captured: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const Capturing = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      const label = props.accessibilityLabel as string | undefined;
      if (label) captured[label] = props;
      return React.createElement(
        actual.Pressable as React.ComponentType<Record<string, unknown>>,
        { ...props, ref },
      );
    },
  );
  Capturing.displayName = "Pressable";
  return { ...actual, Pressable: Capturing };
});

function flatten(style: unknown): Record<string, unknown> {
  if (typeof style === "function") {
    return flatten(
      (style as (s: { pressed: boolean }) => unknown)({ pressed: false }),
    );
  }
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, s) => ({ ...acc, ...flatten(s) }),
      {},
    );
  }
  return (style as Record<string, unknown> | null | undefined) ?? {};
}

function expectRealBox(label: string) {
  const props = captured[label];
  expect(props, `no Pressable captured for "${label}"`).toBeDefined();
  expect(props.hitSlop).toBeUndefined();
  const style = flatten(props.style);
  const w = (style.width ?? style.minWidth) as number;
  const h = (style.height ?? style.minHeight) as number;
  expect(w).toBeGreaterThanOrEqual(44);
  expect(h).toBeGreaterThanOrEqual(44);
}

describe("icon-only buttons are a real 44pt box, not hitSlop", () => {
  it("ChatBubble read-aloud button", () => {
    renderComponent(
      <ChatBubble role="assistant" content="Hi" onSpeak={vi.fn()} />,
    );
    expectRealBox("Read aloud");
  });

  it("ParsedFoodPreview remove button", () => {
    renderComponent(
      <ParsedFoodPreview
        items={[
          {
            name: "Apple",
            quantity: 1,
            unit: "each",
            calories: 95,
            protein: 0,
            carbs: 25,
            fat: 0,
            servingSize: null,
          },
        ]}
        onRemoveItem={vi.fn()}
        onLogAll={vi.fn()}
        isLogging={false}
      />,
    );
    expectRealBox("Remove Apple");
  });

  it("ServingStepperChip minus and plus buttons", () => {
    renderComponent(
      <ServingStepperChip
        servingCount={4}
        isAdjusted={false}
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onSetServings={vi.fn()}
      />,
    );
    expectRealBox("Decrease servings");
    expectRealBox("Increase servings");
  });
});
