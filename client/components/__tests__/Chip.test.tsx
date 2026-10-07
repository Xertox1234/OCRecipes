// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { Chip } from "../Chip";

const { a11y, mockSelection, withTimingSpy } = vi.hoisted(() => ({
  a11y: { reducedMotion: false },
  mockSelection: vi.fn(),
  withTimingSpy: vi.fn((val: number) => val),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    selection: mockSelection,
    impact: vi.fn(),
    notification: vi.fn(),
  }),
}));

vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withTiming: withTimingSpy };
});

beforeEach(() => {
  a11y.reducedMotion = false;
  mockSelection.mockClear();
  withTimingSpy.mockClear();
});

describe("Chip", () => {
  it("renders label text", () => {
    renderComponent(<Chip label="Vegan" />);
    expect(screen.getByText("Vegan")).toBeDefined();
  });

  it("renders as a button when onPress is provided", () => {
    const onPress = vi.fn();
    renderComponent(<Chip label="Filter" onPress={onPress} />);
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("renders as static (non-button) when onPress is absent", () => {
    renderComponent(<Chip label="Badge" />);
    // No button role — rendered as Animated.View (div), not Pressable
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Badge")).toBeDefined();
  });

  it("calls onPress when clicked", () => {
    const onPress = vi.fn();
    renderComponent(<Chip label="Click" onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("exposes selected accessibility state", () => {
    renderComponent(<Chip label="Active" selected onPress={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-selected")).toBe("true");
  });

  it("uses tab accessibility role for tab variant", () => {
    renderComponent(<Chip label="Tab" variant="tab" onPress={() => {}} />);
    expect(screen.getByRole("tab")).toBeDefined();
  });

  it("renders all 4 variants without crashing", () => {
    const variants = ["outline", "filled", "tab", "filter"] as const;
    for (const variant of variants) {
      const { unmount } = renderComponent(
        <Chip label={variant} variant={variant} />,
      );
      expect(screen.getByText(variant)).toBeDefined();
      unmount();
    }
  });

  it("uses label as default accessibility label", () => {
    renderComponent(<Chip label="Gluten Free" onPress={() => {}} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Gluten Free",
    );
  });
});

describe("Chip — selection feedback", () => {
  it("ticks once before calling onPress when the chip is selectable", () => {
    const calls: string[] = [];
    mockSelection.mockImplementation(() => calls.push("tick"));
    renderComponent(
      <Chip
        label="Vegan"
        selected={false}
        onPress={() => calls.push("press")}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(calls).toEqual(["tick", "press"]);
    mockSelection.mockImplementation(() => undefined);
  });

  it("ticks when tapping an already-selected chip too", () => {
    renderComponent(<Chip label="Vegan" selected onPress={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    expect(mockSelection).toHaveBeenCalledTimes(1);
  });

  it("stays silent for an action chip that takes no selected prop", () => {
    const onPress = vi.fn();
    renderComponent(<Chip label="pasta" onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledOnce();
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it("does not tick when selected changes without a press", () => {
    const { rerender } = renderComponent(
      <Chip label="Vegan" selected={false} onPress={() => {}} />,
    );
    rerender(<Chip label="Vegan" selected onPress={() => {}} />);
    expect(mockSelection).not.toHaveBeenCalled();
  });
});

describe("Chip — selected state animation", () => {
  it("does not animate on mount", () => {
    renderComponent(<Chip label="Vegan" selected onPress={() => {}} />);
    expect(withTimingSpy).not.toHaveBeenCalled();
  });

  it("fades toward the new state when selected changes", () => {
    const { rerender } = renderComponent(
      <Chip label="Vegan" selected={false} onPress={() => {}} />,
    );
    rerender(<Chip label="Vegan" selected onPress={() => {}} />);
    expect(withTimingSpy).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ duration: expect.any(Number) }),
    );
    const [, config] = withTimingSpy.mock.lastCall as unknown as [
      number,
      { duration: number },
    ];
    expect(config.duration).toBeGreaterThan(0);

    rerender(<Chip label="Vegan" selected={false} onPress={() => {}} />);
    expect(withTimingSpy).toHaveBeenLastCalledWith(0, expect.anything());
  });

  it("snaps to the new state under reduced motion", () => {
    a11y.reducedMotion = true;
    const { rerender } = renderComponent(
      <Chip label="Vegan" selected={false} onPress={() => {}} />,
    );
    rerender(<Chip label="Vegan" selected onPress={() => {}} />);
    expect(withTimingSpy).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({ duration: 0 }),
    );
  });
});
