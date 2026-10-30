// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { TextInput as RNTextInput } from "react-native";
import * as Reanimated from "react-native-reanimated";

import { Colors } from "@/constants/theme";
import { renderComponent } from "../../../test/utils/render-component";
import { FocusField } from "../FocusField";
import { useFieldFocus } from "../useFieldFocus";
import { shouldFloatLabel } from "../text-input-utils";

// Spies at the mock boundary: jsdom cannot read an animated style array or
// `pointerEvents` off the DOM (React drops the camelCase prop), so the tests
// observe the values the component hands Reanimated — the label's initial
// float progress (useSharedValue), the overlay styles (useAnimatedStyle) and
// Animated.View's raw props, captured by testID.
const viewProps = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock("react-native-reanimated", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<Record<string, unknown>>();
  const Animated = actual.default as Record<string, React.ElementType>;
  const View = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      if (typeof props.testID === "string") viewProps.set(props.testID, props);
      return React.createElement(Animated.View, { ...props, ref });
    },
  );
  View.displayName = "Animated.View";
  const Text = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      if (typeof props.testID === "string") viewProps.set(props.testID, props);
      return React.createElement(Animated.Text, { ...props, ref });
    },
  );
  Text.displayName = "Animated.Text";
  return {
    ...actual,
    default: { ...Animated, View, Text },
    useSharedValue: vi.fn(actual.useSharedValue as (n: number) => unknown),
    useAnimatedStyle: vi.fn(
      actual.useAnimatedStyle as (fn: () => unknown) => unknown,
    ),
  };
});

function Field(props: {
  label?: string;
  hasValue?: boolean;
  error?: boolean;
  labelLeft?: number;
  paddingLeft?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const focus = useFieldFocus({ onFocus: props.onFocus, onBlur: props.onBlur });
  return (
    <FocusField
      focus={focus}
      style={{ borderRadius: 8, paddingLeft: props.paddingLeft }}
      label={props.label}
      labelLeft={props.labelLeft}
      hasValue={props.hasValue}
      error={props.error}
    >
      <RNTextInput
        placeholder="Type here"
        onFocus={focus.onFocus}
        onBlur={focus.onBlur}
      />
    </FocusField>
  );
}

function animatedStyles(): Record<string, unknown>[] {
  return vi
    .mocked(Reanimated.useAnimatedStyle)
    .mock.results.map((r) => r.value as Record<string, unknown>);
}

describe("FocusField", () => {
  beforeEach(() => {
    vi.mocked(Reanimated.useSharedValue).mockClear();
    vi.mocked(Reanimated.useAnimatedStyle).mockClear();
    viewProps.clear();
  });

  it("renders its children", () => {
    renderComponent(<Field />);
    expect(screen.getByPlaceholderText("Type here")).toBeDefined();
  });

  it("draws fill and ring overlays that never take touches and are hidden from screen readers", () => {
    renderComponent(<Field />);
    for (const id of ["focus-field-fill", "focus-field-ring"]) {
      expect(viewProps.get(id)?.pointerEvents).toBe("none");
      expect(screen.getByTestId(id).getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("orders the fill under the children and the ring over them", () => {
    renderComponent(<Field />);
    const fill = screen.getByTestId("focus-field-fill");
    const ring = screen.getByTestId("focus-field-ring");
    const input = screen.getByPlaceholderText("Type here");
    const container = fill.parentElement!;
    expect(ring.parentElement).toBe(container);
    const kids = Array.from(container.children);
    expect(kids.indexOf(fill)).toBeLessThan(kids.indexOf(input));
    expect(kids.indexOf(ring)).toBeGreaterThan(kids.indexOf(input));
  });

  it("puts the caller's testID on the field container that holds the overlays", () => {
    function Tagged() {
      const focus = useFieldFocus();
      return (
        <FocusField focus={focus} testID="search-field">
          <RNTextInput placeholder="Type here" />
        </FocusField>
      );
    }
    renderComponent(<Tagged />);
    const field = screen.getByTestId("search-field");
    expect(field).toBe(screen.getByTestId("focus-field-ring").parentElement);
    expect(field.contains(screen.getByPlaceholderText("Type here"))).toBe(true);
  });

  it("renders the label text hidden from the accessibility tree", () => {
    renderComponent(<Field label="Recipe title" />);
    const label = screen.getByText("Recipe title");
    expect(label.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders no label when none is given", () => {
    renderComponent(<Field />);
    expect(screen.queryByTestId("focus-field-label")).toBeNull();
    renderComponent(<Field label="Recipe title" />);
    expect(screen.getByTestId("focus-field-label")).toBeDefined();
  });

  it("sets the label at the container's paddingLeft, or at labelLeft when given", () => {
    // The label's style array, merged in order (the inline `left` is plain).
    const labelLeftOf = () =>
      Object.assign(
        {},
        ...(viewProps.get("focus-field-label")?.style as object[]),
      ).left;
    renderComponent(<Field label="Recipe title" paddingLeft={12} />);
    expect(labelLeftOf()).toBe(12);

    viewProps.clear();
    renderComponent(
      <Field label="Recipe title" paddingLeft={12} labelLeft={28} />,
    );
    expect(labelLeftOf()).toBe(28);
  });

  it("starts the label floated when the field already has a value", () => {
    // The same path the component takes: not focused, but has text.
    expect(shouldFloatLabel(false, "x")).toBe(true);
    renderComponent(<Field label="Recipe title" hasValue />);
    expect(Reanimated.useSharedValue).toHaveBeenCalledWith(1);
  });

  it("starts the label resting when the field is empty and unfocused", () => {
    renderComponent(<Field label="Recipe title" />);
    expect(Reanimated.useSharedValue).not.toHaveBeenCalledWith(1);
  });

  it("rings in the focus colour at rest opacity 0, and in the error colour at full opacity on error", () => {
    renderComponent(<Field />);
    expect(animatedStyles()).toContainEqual({
      opacity: 0,
      borderColor: Colors.light.focusRing,
    });

    vi.mocked(Reanimated.useAnimatedStyle).mockClear();
    renderComponent(<Field error />);
    expect(animatedStyles()).toContainEqual({
      opacity: 1,
      borderColor: Colors.light.error,
    });
  });

  it("gives a labelled field at least 56px, keeping a taller caller minHeight", () => {
    function Sized(props: { minHeight?: number }) {
      const focus = useFieldFocus();
      return (
        <FocusField
          focus={focus}
          testID="sized-field"
          style={{ borderRadius: 8, minHeight: props.minHeight }}
          label="Note"
        >
          <RNTextInput placeholder="Type here" />
        </FocusField>
      );
    }
    // The test StyleSheet.flatten is identity, so merge the array by hand.
    const merge = (s: unknown): Record<string, unknown> =>
      Array.isArray(s)
        ? Object.assign({}, ...s.map(merge))
        : ((s as Record<string, unknown>) ?? {});
    const minHeightOf = () =>
      merge(viewProps.get("sized-field")?.style).minHeight;

    renderComponent(<Sized minHeight={100} />);
    expect(minHeightOf()).toBe(100);

    viewProps.clear();
    renderComponent(<Sized />);
    expect(minHeightOf()).toBe(56);

    viewProps.clear();
    renderComponent(<Sized minHeight={40} />);
    expect(minHeightOf()).toBe(56);
  });

  it("calls the caller's onFocus and onBlur once each through useFieldFocus", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderComponent(<Field onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByPlaceholderText("Type here");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
  });
});
