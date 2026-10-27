// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Reanimated from "react-native-reanimated";
import { Colors, Spacing } from "@/constants/theme";
import { renderComponent } from "../../../test/utils/render-component";
import { TextInput } from "../TextInput";
import { FocusField } from "../FocusField";

// jsdom cannot read a style array (or an animated style) off the DOM, so the
// tests observe the values handed across the mock boundary: the animated
// styles (useAnimatedStyle), the inner input's props, the floating label's
// props and FocusField's props.
const captured = vi.hoisted(() => ({
  input: {} as Record<string, unknown>,
  label: {} as Record<string, unknown>,
}));

vi.mock("react-native-reanimated", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<Record<string, unknown>>();
  const Animated = actual.default as Record<string, React.ElementType>;
  const Text = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      if (props.testID === "focus-field-label") captured.label = props;
      return React.createElement(Animated.Text, { ...props, ref });
    },
  );
  Text.displayName = "Animated.Text";
  return {
    ...actual,
    default: { ...Animated, Text },
    useAnimatedStyle: vi.fn(
      actual.useAnimatedStyle as (fn: () => unknown) => unknown,
    ),
  };
});

vi.mock("react-native", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<Record<string, unknown>>();
  const Base = actual.TextInput as React.ElementType;
  const TextInput = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      captured.input = props;
      return React.createElement(Base, { ...props, ref });
    },
  );
  TextInput.displayName = "TextInput";
  return { ...actual, TextInput };
});

vi.mock("../FocusField", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../FocusField")>();
  return { FocusField: vi.fn(actual.FocusField) };
});

/** Merge a (possibly nested) RN style array the way StyleSheet.flatten does. */
function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return (style as Record<string, unknown>) ?? {};
}

describe("TextInput", () => {
  it("renders an input element", () => {
    renderComponent(<TextInput placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here")).toBeDefined();
  });

  it("renders left icon when provided", () => {
    renderComponent(<TextInput leftIcon="search" placeholder="Search" />);
    // Feather mock renders a span with data-icon attribute
    expect(screen.getByText("search")).toBeDefined();
  });

  it("renders right icon when provided", () => {
    renderComponent(<TextInput rightIcon="eye" placeholder="Password" />);
    expect(screen.getByText("eye")).toBeDefined();
  });

  it("calls onRightIconPress when right icon button is clicked", () => {
    const onRightIconPress = vi.fn();
    renderComponent(
      <TextInput
        rightIcon="eye-off"
        onRightIconPress={onRightIconPress}
        placeholder="Password"
      />,
    );
    // Right icon should be wrapped in a Pressable (renders as button)
    const iconBtn = screen.getByRole("button");
    fireEvent.click(iconBtn);
    expect(onRightIconPress).toHaveBeenCalledOnce();
  });

  it("renders right icon as static when no onRightIconPress", () => {
    renderComponent(<TextInput rightIcon="check" placeholder="Done" />);
    expect(screen.getByText("check")).toBeDefined();
    // No button for the icon
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("applies error accessibility hint when error is set", () => {
    renderComponent(
      <TextInput
        placeholder="Email"
        error
        errorMessage="Invalid email address"
      />,
    );
    const input = screen.getByPlaceholderText("Email");
    expect(input.getAttribute("aria-hint")).toBe("Invalid email address");
  });

  it("appends error message to caller-supplied accessibilityHint when error is set", () => {
    renderComponent(
      <TextInput
        placeholder="Email"
        error
        errorMessage="Invalid email address"
        accessibilityHint="Enter a valid email address"
      />,
    );
    const input = screen.getByPlaceholderText("Email");
    expect(input.getAttribute("aria-hint")).toBe(
      "Enter a valid email address. Invalid email address",
    );
  });

  it("uses rightIconAccessibilityLabel for icon button", () => {
    renderComponent(
      <TextInput
        rightIcon="eye"
        onRightIconPress={() => {}}
        rightIconAccessibilityLabel="Toggle password visibility"
        placeholder="Password"
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-label")).toBe("Toggle password visibility");
  });

  it("has displayName set", () => {
    expect(TextInput.displayName).toBe("TextInput");
  });
});

describe("TextInput floating label & focus", () => {
  it("renders the floating label text when label is provided", () => {
    renderComponent(<TextInput label="Note title" />);
    expect(screen.getByText("Note title")).toBeDefined();
  });

  it("uses the label as the input accessibility label by default", () => {
    renderComponent(<TextInput label="Note title" />);
    expect(screen.getByLabelText("Note title")).toBeDefined();
  });

  it("prefers an explicit accessibilityLabel over the label", () => {
    renderComponent(
      <TextInput label="Note title" accessibilityLabel="Custom" />,
    );
    expect(screen.getByLabelText("Custom")).toBeDefined();
  });

  it("suppresses the placeholder while the label is resting in its place", () => {
    renderComponent(
      <TextInput label="Note title" placeholder="e.g. Less salt" />,
    );
    expect(screen.queryByPlaceholderText("e.g. Less salt")).toBeNull();
  });

  it("shows the placeholder once the input is focused", () => {
    renderComponent(
      <TextInput label="Note title" placeholder="e.g. Less salt" />,
    );
    fireEvent.focus(screen.getByLabelText("Note title"));
    expect(screen.getByPlaceholderText("e.g. Less salt")).toBeDefined();
  });

  it("keeps the label floated at rest when the input has a value", () => {
    renderComponent(
      <TextInput
        label="Note title"
        placeholder="e.g. Less salt"
        value="Less salt"
        onChangeText={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText("e.g. Less salt")).toBeDefined();
  });

  it("keeps the label floated after typing and blurring (uncontrolled)", () => {
    renderComponent(
      <TextInput label="Note title" placeholder="e.g. Less salt" />,
    );
    const input = screen.getByLabelText("Note title");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Less salt" } });
    fireEvent.blur(input);
    // internalValue tracking keeps the label floated once content exists
    expect(screen.getByPlaceholderText("e.g. Less salt")).toBeDefined();
  });

  it("still reveals the placeholder on focus when reduced motion is enabled", () => {
    const spy = vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    try {
      renderComponent(
        <TextInput label="Note title" placeholder="e.g. Less salt" />,
      );
      fireEvent.focus(screen.getByLabelText("Note title"));
      // reduced motion snaps the transition but must never drop the state
      expect(screen.getByPlaceholderText("e.g. Less salt")).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("forwards onFocus and onBlur to callers", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderComponent(
      <TextInput placeholder="Email" onFocus={onFocus} onBlur={onBlur} />,
    );
    const input = screen.getByPlaceholderText("Email");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
  });
});

describe("TextInput focus ring", () => {
  beforeEach(() => {
    vi.mocked(Reanimated.useAnimatedStyle).mockClear();
  });

  it("keeps the error ring when an errored field gains focus", () => {
    renderComponent(
      <TextInput placeholder="Email" error errorMessage="Invalid email" />,
    );
    fireEvent.focus(screen.getByPlaceholderText("Email"));

    expect(screen.getByTestId("focus-field-ring")).toBeDefined();
    const styles = vi
      .mocked(Reanimated.useAnimatedStyle)
      .mock.results.map((r) => r.value as Record<string, unknown>);
    expect(styles).toContainEqual({
      opacity: 1,
      borderColor: Colors.light.error,
    });
    // Error wins over focus: no style ever switches to the focus colour.
    expect(styles.some((s) => s.borderColor === Colors.light.focusRing)).toBe(
      false,
    );
  });
});

describe("TextInput label and text inset", () => {
  function geometry() {
    const field = vi.mocked(FocusField).mock.lastCall![0];
    const box = flat(field.style);
    const containerLeft = (box.paddingLeft ?? box.paddingHorizontal) as number;
    return {
      containerLeft,
      inputLeft: flat(captured.input.style).paddingLeft as number,
      labelLeft: flat(captured.label.style).left as number,
    };
  }

  beforeEach(() => {
    vi.mocked(FocusField).mockClear();
  });

  it("keeps the inset inside the input and sets the label at the text start", () => {
    renderComponent(<TextInput label="Note title" />);
    const g = geometry();
    // The container keeps its plain 12px padding, so the input (and its
    // tappable box) runs from there; the 16px inset is the input's own.
    expect(g.containerLeft).toBe(Spacing.md);
    expect(g.inputLeft).toBe(Spacing.lg);
    expect(g.labelLeft).toBe(g.containerLeft + g.inputLeft);
  });

  it("sets the label after a left icon, where the text starts", () => {
    renderComponent(<TextInput label="Search" leftIcon="search" />);
    const g = geometry();
    expect(g.containerLeft).toBe(Spacing.md);
    expect(g.inputLeft).toBe(0);
    // 20px icon + its 8px gap, both in the row before the input.
    expect(g.labelLeft).toBe(Spacing.md + 20 + Spacing.sm);
  });

  it("lays out an unlabelled field as before", () => {
    renderComponent(<TextInput placeholder="Email" />);
    const g = geometry();
    expect(g.containerLeft).toBe(Spacing.md);
    expect(g.inputLeft).toBe(Spacing.lg);
  });
});
