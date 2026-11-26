// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { StyleProp, ViewStyle } from "react-native";
import { ExampleCard } from "../ExampleCard";
import type { ScanExampleKey } from "@/lib/feature-tips-storage";

// The shared Pressable mock drops `style`, which would hide the 44pt
// minHeight. Render PressableScale as the TouchableOpacity mock (keeps style)
// with its style flattened — same harness as StepTabs.test.tsx.
vi.mock("@/components/PressableScale", async () => {
  const RN = await import("react-native");
  const flat = (s: unknown): unknown =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flat).filter(Boolean)) : s;
  return {
    PressableScale: ({
      style,
      scaleTo: _scaleTo,
      ...props
    }: Record<string, unknown>) => (
      <RN.TouchableOpacity
        {...props}
        style={flat(style) as StyleProp<ViewStyle>}
      />
    ),
  };
});

const accessibility = { reducedMotion: false };
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => accessibility,
}));

const selection = vi.fn();
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ selection }),
}));

const CASES: [ScanExampleKey, string, string][] = [
  [
    "barcode",
    "Scan the barcode",
    "Line it up inside the frame. It scans by itself. No tap needed.",
  ],
  [
    "barcode-nutrition",
    "Photo the nutrition label",
    "We check the numbers against the real package, so your log is accurate.",
  ],
  [
    "barcode-front",
    "Photo the front (optional)",
    "Helps with the name, brand and size when the barcode isn't in our database.",
  ],
];

describe("ExampleCard", () => {
  beforeEach(() => {
    selection.mockClear();
    accessibility.reducedMotion = false;
  });

  it.each(CASES)(
    "renders the title and body for each ScanExampleKey (%s)",
    (key, title, body) => {
      render(<ExampleCard exampleKey={key} onDismiss={vi.fn()} />);
      // The title is one header; "(optional)" is a nested, muted span, so
      // match the header's whole text rather than a single text node.
      expect(
        screen.getByText(
          (_, el) =>
            el?.getAttribute("role") === "header" && el.textContent === title,
        ),
      ).toBeTruthy();
      expect(screen.getByText(body)).toBeTruthy();
    },
  );

  it('"Got it" calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<ExampleCard exampleKey="barcode" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText("Got it"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('"Got it" min height ≥ 44 and role button', () => {
    render(<ExampleCard exampleKey="barcode" onDismiss={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Got it" });
    expect(
      parseFloat(getComputedStyle(button).minHeight),
    ).toBeGreaterThanOrEqual(44);
  });

  it("is the only button on the card (the art is not focusable)", () => {
    render(<ExampleCard exampleKey="barcode-nutrition" onDismiss={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
