// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SelectableTile } from "../SelectableTile";
import { ThemedText } from "../ThemedText";

const { mockSelection, usePressScaleSpy } = vi.hoisted(() => ({
  mockSelection: vi.fn(),
  usePressScaleSpy: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    selection: mockSelection,
    impact: vi.fn(),
    notification: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePressScale", () => ({
  usePressScale: (scaleTo: number, opts: unknown) => {
    usePressScaleSpy(scaleTo, opts);
    return { animatedStyle: {}, onPressIn: vi.fn(), onPressOut: vi.fn() };
  },
}));

beforeEach(() => {
  mockSelection.mockReset();
  usePressScaleSpy.mockClear();
});

function renderTile(
  props: Partial<React.ComponentProps<typeof SelectableTile>>,
) {
  return renderComponent(
    <SelectableTile
      onPress={vi.fn()}
      accessibilityRole="checkbox"
      accessibilityLabel="Peanuts"
      {...props}
    >
      <ThemedText>Peanuts</ThemedText>
    </SelectableTile>,
  );
}

describe("SelectableTile", () => {
  it("ticks once, before calling onPress", () => {
    const calls: string[] = [];
    mockSelection.mockImplementation(() => calls.push("tick"));
    renderTile({ onPress: () => calls.push("press") });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(calls).toEqual(["tick", "press"]);
  });

  it("does not tick when disabled", () => {
    const onPress = vi.fn();
    renderTile({ onPress, disabled: true });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onPress).not.toHaveBeenCalled();
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it("passes accessibility props through", () => {
    renderTile({ accessibilityState: { checked: true } });
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it.each([
    ["tile", 0.97],
    ["chip", 0.95],
  ] as const)("a %s scales to %s on press", (shape, scale) => {
    renderTile({ shape });
    expect(usePressScaleSpy).toHaveBeenCalledWith(scale, expect.anything());
  });

  it("defaults to the tile scale", () => {
    renderTile({});
    expect(usePressScaleSpy).toHaveBeenCalledWith(0.97, expect.anything());
  });

  it("a row dims instead of scaling", () => {
    renderTile({ shape: "row" });
    expect(usePressScaleSpy).not.toHaveBeenCalled();
    // Still ticks — the row shape changes only the visual press feedback.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(mockSelection).toHaveBeenCalledTimes(1);
  });
});
