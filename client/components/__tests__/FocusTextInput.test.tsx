// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, within } from "@testing-library/react";

import { renderComponent } from "../../../test/utils/render-component";
import { FocusTextInput } from "../FocusTextInput";
import { FocusBottomSheetTextInput } from "../FocusBottomSheetTextInput";

// jsdom cannot read a style array off the DOM, and FocusField hands its root
// Animated.View one — so record every Animated.View's raw props and read the
// style there. The input itself gets a single object, so its DOM style is
// readable directly.
const viewProps = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("react-native-reanimated", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<Record<string, unknown>>();
  const Animated = actual.default as Record<string, React.ElementType>;
  const View = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      viewProps.push(props);
      return React.createElement(Animated.View, { ...props, ref });
    },
  );
  View.displayName = "Animated.View";
  return { ...actual, default: { ...Animated, View } };
});

function flattenDeep(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenDeep));
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

/** The style of the Animated.View that draws the visible field (FocusField's root). */
function fieldBoxStyle(): Record<string, unknown> | undefined {
  return viewProps
    .map((p) => flattenDeep(p.style))
    .find((s) => s.backgroundColor === "rebeccapurple");
}

// Plain object: the react-native mock's StyleSheet.flatten is the identity.
const callerStyle = {
  backgroundColor: "rebeccapurple",
  borderRadius: 8,
  height: 48,
  color: "white",
  fontSize: 14,
  paddingLeft: 12, // jsdom drops RN-only shorthands like paddingHorizontal
};

beforeEach(() => {
  viewProps.length = 0;
});

describe("FocusTextInput", () => {
  it("renders an input and forwards props", () => {
    renderComponent(
      <FocusTextInput placeholder="Type here" accessibilityLabel="Notes" />,
    );
    expect(screen.getByPlaceholderText("Type here")).toBeDefined();
  });

  it("calls the caller's onFocus and onBlur", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    renderComponent(
      <FocusTextInput
        placeholder="Type here"
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    const input = screen.getByPlaceholderText("Type here");
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledOnce();
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it("forwards onChangeText", () => {
    const onChangeText = vi.fn();
    renderComponent(
      <FocusTextInput placeholder="Type here" onChangeText={onChangeText} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Type here"), {
      target: { value: "hi" },
    });
    expect(onChangeText).toHaveBeenCalledWith("hi");
  });

  it("draws the field on a FocusField that carries the caller's box style", () => {
    renderComponent(
      <FocusTextInput placeholder="Type here" style={callerStyle} />,
    );
    const input = screen.getByPlaceholderText("Type here");

    // The ring lives in the input's parent — the visible field.
    expect(
      within(input.parentElement as HTMLElement).getByTestId(
        "focus-field-ring",
      ),
    ).toBeDefined();

    const box = fieldBoxStyle();
    expect(box).toMatchObject({ borderRadius: 8, height: 48 });
    expect(box).not.toHaveProperty("color");
    expect(box).not.toHaveProperty("fontSize");
  });

  it("keeps the text styles on the input and makes it fill the box", () => {
    renderComponent(
      <FocusTextInput placeholder="Type here" style={callerStyle} />,
    );
    const input = screen.getByPlaceholderText("Type here");
    expect(input.style.color).toBe("white");
    expect(input.style.fontSize).toBe("14px");
    expect(input.style.paddingLeft).toBe("12px");
    expect(input.style.flexGrow).toBe("1");
    expect(input.style.flexShrink).toBe("1");
    // Box keys went to the field — the input draws no fill, edge or size.
    expect(input.style.backgroundColor).toBe("");
    expect(input.style.borderRadius).toBe("");
    expect(input.style.height).toBe("");
  });

  it("with focusRing={false} renders the bare input with the caller's style and handlers", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const { container } = renderComponent(
      <FocusTextInput
        placeholder="Type here"
        focusRing={false}
        style={callerStyle}
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    const input = screen.getByPlaceholderText("Type here");
    expect(screen.queryByTestId("focus-field-ring")).toBeNull();
    expect(input.parentElement).toBe(container);
    expect(input.style.backgroundColor).toBe("rebeccapurple");
    expect(input.style.height).toBe("48px");
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledOnce();
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledOnce();
  });
});

describe("FocusBottomSheetTextInput", () => {
  it("draws the field on a FocusField and keeps the text styles on the input", () => {
    const onFocus = vi.fn();
    renderComponent(
      <FocusBottomSheetTextInput
        placeholder="Search"
        style={callerStyle}
        onFocus={onFocus}
      />,
    );
    const input = screen.getByPlaceholderText("Search");
    expect(
      within(input.parentElement as HTMLElement).getByTestId(
        "focus-field-ring",
      ),
    ).toBeDefined();
    expect(fieldBoxStyle()).toMatchObject({ borderRadius: 8, height: 48 });
    expect(input.style.color).toBe("white");
    expect(input.style.backgroundColor).toBe("");
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it("with focusRing={false} renders the bare input with the caller's style and handlers", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const { container } = renderComponent(
      <FocusBottomSheetTextInput
        placeholder="Search"
        focusRing={false}
        style={callerStyle}
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    const input = screen.getByPlaceholderText("Search");
    expect(screen.queryByTestId("focus-field-ring")).toBeNull();
    expect(input.parentElement).toBe(container);
    expect(input.style.backgroundColor).toBe("rebeccapurple");
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledOnce();
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledOnce();
  });
});

describe.each([
  ["FocusTextInput", FocusTextInput],
  ["FocusBottomSheetTextInput", FocusBottomSheetTextInput],
] as const)("%s with a label", (_name, Input) => {
  function renderLabelled(props: Record<string, unknown> = {}) {
    return renderComponent(
      <Input
        label="Cookbook name"
        placeholder="e.g. Weeknight dinners"
        value=""
        style={callerStyle}
        {...props}
      />,
    );
  }

  it("floats the label on the field and names the input with it", () => {
    renderLabelled();
    expect(screen.getByTestId("focus-field-label").textContent).toBe(
      "Cookbook name",
    );
    expect(screen.getByLabelText("Cookbook name").tagName).toMatch(
      /INPUT|TEXTAREA/,
    );
  });

  it("keeps an explicit accessibilityLabel over the label", () => {
    renderLabelled({ accessibilityLabel: "Cookbook name for the new book" });
    expect(
      screen.getByLabelText("Cookbook name for the new book"),
    ).toBeDefined();
  });

  it("hides the placeholder while the label rests and shows it once floated", () => {
    renderLabelled();
    const input = screen.getByLabelText("Cookbook name");
    expect(input.getAttribute("placeholder")).toBeNull();
    fireEvent.focus(input);
    expect(input.getAttribute("placeholder")).toBe("e.g. Weeknight dinners");
  });

  it("shows the placeholder when the field has a value", () => {
    renderLabelled({ value: "Soups" });
    expect(
      screen.getByLabelText("Cookbook name").getAttribute("placeholder"),
    ).toBe("e.g. Weeknight dinners");
  });

  it("pads the input under the floated label and makes the field two rows tall", () => {
    renderLabelled({
      style: { ...callerStyle, paddingTop: 4, lineHeight: 30 },
    });
    const input = screen.getByLabelText("Cookbook name");
    expect(input.style.paddingTop).toBe("26px");
    expect(input.style.paddingBottom).toBe("10px");
    expect(input.style.lineHeight).toBe("18"); // jsdom keeps it unitless
    expect(input.style.paddingLeft).toBe("12px");
    // The field reserves the two-row height.
    expect(
      viewProps
        .map((p) => flattenDeep(p.style))
        .some((s) => s.minHeight === 56),
    ).toBe(true);
  });
});
