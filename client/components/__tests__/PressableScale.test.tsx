// @vitest-environment jsdom
import React from "react";
import { Text } from "react-native";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { PressableScale } from "../PressableScale";

const { mockHookPressIn, mockHookPressOut, hookArgs } = vi.hoisted(() => ({
  mockHookPressIn: vi.fn(),
  mockHookPressOut: vi.fn(),
  hookArgs: [] as unknown[][],
}));

vi.mock("@/hooks/usePressScale", () => ({
  usePressScale: (...args: unknown[]) => {
    hookArgs.push(args);
    return {
      animatedStyle: {},
      onPressIn: mockHookPressIn,
      onPressOut: mockHookPressOut,
      scale: { value: 1 },
    };
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  hookArgs.length = 0;
});

describe("PressableScale", () => {
  it("renders its children and fires onPress", () => {
    const onPress = vi.fn();
    renderComponent(
      <PressableScale onPress={onPress} accessibilityLabel="Open">
        <Text>Recipe</Text>
      </PressableScale>,
    );

    expect(screen.getByText("Recipe")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open"));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("drives the press scale on press-in and press-out", () => {
    renderComponent(
      <PressableScale
        onPress={vi.fn()}
        accessibilityLabel="Open"
        scaleTo={0.97}
      >
        <Text>Recipe</Text>
      </PressableScale>,
    );

    fireEvent.mouseDown(screen.getByLabelText("Open"));
    fireEvent.mouseUp(screen.getByLabelText("Open"));

    expect(mockHookPressIn).toHaveBeenCalledOnce();
    expect(mockHookPressOut).toHaveBeenCalledOnce();
    expect(hookArgs[0]).toEqual([0.97, { enabled: true }]);
  });

  it("still calls the caller's own onPressIn and onPressOut", () => {
    const onPressIn = vi.fn();
    const onPressOut = vi.fn();
    renderComponent(
      <PressableScale
        onPress={vi.fn()}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityLabel="Open"
      >
        <Text>Recipe</Text>
      </PressableScale>,
    );

    fireEvent.mouseDown(screen.getByLabelText("Open"));
    fireEvent.mouseUp(screen.getByLabelText("Open"));

    expect(onPressIn).toHaveBeenCalledOnce();
    expect(onPressOut).toHaveBeenCalledOnce();
    expect(mockHookPressIn).toHaveBeenCalledOnce();
  });

  it("does not scale when disabled", () => {
    renderComponent(
      <PressableScale onPress={vi.fn()} accessibilityLabel="Open" disabled>
        <Text>Recipe</Text>
      </PressableScale>,
    );

    expect(hookArgs[0]).toEqual([0.98, { enabled: false }]);
  });
});
