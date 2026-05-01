/* eslint-disable react/display-name */
// Mock react-native for Vitest — the real module uses Flow syntax that Rollup can't parse.
import React from "react";

export const Platform = {
  OS: "ios" as const,
  select: (obj: Record<string, unknown>) => obj.ios,
};
export const useColorScheme = () => "light";
export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown) => style,
};
export const Appearance = { getColorScheme: () => "light" };
export const Dimensions = { get: () => ({ width: 375, height: 812 }) };
export const useWindowDimensions = () => ({ width: 375, height: 812 });
export const Alert = { alert: () => {} };
export const Linking = { openURL: async () => {} };
export const NativeModules = {};

// ---------------------------------------------------------------------------
// React-component mocks for jsdom component rendering tests
// ---------------------------------------------------------------------------

/** Helper to create a forwarding mock component that renders an HTML element. */
function mockComponent(
  Element: string,
  displayName: string,
): React.ForwardRefExoticComponent<
  React.PropsWithoutRef<Record<string, unknown>> & React.RefAttributes<unknown>
> {
  const Comp = React.forwardRef<unknown, Record<string, unknown>>(
    (
      {
        children,
        testID,
        accessibilityRole,
        accessibilityLabel,
        accessibilityHint,
        accessibilityState,
        ...rest
      },
      ref,
    ) => {
      const a11y = accessibilityState as Record<string, unknown> | undefined;
      return React.createElement(
        Element,
        {
          ref,
          "data-testid": testID,
          role: accessibilityRole,
          "aria-label": accessibilityLabel,
          "aria-hint": accessibilityHint,
          ...(a11y?.disabled != null && {
            "aria-disabled": a11y.disabled,
          }),
          ...(a11y?.selected != null && {
            "aria-selected": a11y.selected,
          }),
          ...(a11y?.busy != null && {
            "aria-busy": a11y.busy,
          }),
          ...rest,
        } as Record<string, unknown>,
        children as React.ReactNode,
      );
    },
  );
  Comp.displayName = displayName;
  return Comp;
}

export const View = mockComponent("div", "View");

export const Text = mockComponent("span", "Text");

export const Pressable = React.forwardRef<unknown, Record<string, unknown>>(
  (
    {
      children,
      onPress,
      onPressIn,
      onPressOut,
      disabled,
      testID,
      accessibilityRole,
      accessibilityLabel,
      accessibilityHint,
      accessibilityState,
      style: _style,
      ...rest
    },
    ref,
  ) => {
    // Support function-as-child for Pressable's render pattern
    const resolvedChildren =
      typeof children === "function"
        ? (children as (state: { pressed: boolean }) => React.ReactNode)({
            pressed: false,
          })
        : children;
    return React.createElement(
      "button",
      {
        ref,
        onClick: disabled ? undefined : onPress,
        onMouseDown: disabled ? undefined : onPressIn,
        onMouseUp: disabled ? undefined : onPressOut,
        disabled: disabled || undefined,
        "data-testid": testID,
        role: accessibilityRole ?? "button",
        "aria-label": accessibilityLabel,
        "aria-hint": accessibilityHint,
        ...(() => {
          const a11y = accessibilityState as
            | Record<string, unknown>
            | undefined;
          return {
            ...(a11y?.disabled != null && { "aria-disabled": a11y.disabled }),
            ...(a11y?.selected != null && { "aria-selected": a11y.selected }),
            ...(a11y?.busy != null && { "aria-busy": a11y.busy }),
          };
        })(),
        ...rest,
      } as Record<string, unknown>,
      resolvedChildren as React.ReactNode,
    );
  },
);
Pressable.displayName = "Pressable";

export const Image = React.forwardRef<unknown, Record<string, unknown>>(
  ({ source, testID, ...rest }, ref) =>
    React.createElement("img", {
      ref,
      src:
        typeof source === "object" && source !== null
          ? ((source as Record<string, unknown>).uri ?? "")
          : "",
      "data-testid": testID,
      ...rest,
    }),
);
(Image as unknown as { displayName: string }).displayName = "Image";

export const TextInput = React.forwardRef<unknown, Record<string, unknown>>(
  (
    {
      testID,
      accessibilityHint,
      accessibilityLabel,
      placeholderTextColor: _ptc,
      onChangeText,
      ...rest
    },
    ref,
  ) =>
    React.createElement("input", {
      ref,
      "data-testid": testID,
      "aria-hint": accessibilityHint,
      "aria-label": accessibilityLabel,
      onChange: onChangeText
        ? (e: { target: { value: string } }) =>
            (onChangeText as (v: string) => void)(e.target.value)
        : undefined,
      ...rest,
    }),
);
(TextInput as unknown as { displayName: string }).displayName = "TextInput";

export const ScrollView = mockComponent("div", "ScrollView");

/** Shared flat-list rendering logic — used by FlatList and BottomSheetFlatList mocks. */
export function createFlatListMock(displayName: string) {
  const Comp = React.forwardRef<unknown, Record<string, unknown>>(
    (
      {
        data,
        renderItem,
        keyExtractor,
        ListEmptyComponent,
        ListHeaderComponent,
        ListFooterComponent,
        testID,
      },
      ref,
    ) => {
      const items = Array.isArray(data) ? data : [];
      const empty = items.length === 0 && ListEmptyComponent;
      return React.createElement(
        "div",
        { ref, "data-testid": testID },
        ListHeaderComponent
          ? typeof ListHeaderComponent === "function"
            ? React.createElement(
                ListHeaderComponent as React.FunctionComponent,
              )
            : (ListHeaderComponent as React.ReactNode)
          : null,
        empty
          ? typeof ListEmptyComponent === "function"
            ? React.createElement(ListEmptyComponent as React.FunctionComponent)
            : (ListEmptyComponent as React.ReactNode)
          : items.map((item: unknown, index: number) =>
              React.createElement(
                React.Fragment,
                {
                  key: keyExtractor
                    ? (
                        keyExtractor as (item: unknown, index: number) => string
                      )(item, index)
                    : String(index),
                },
                (
                  renderItem as (info: {
                    item: unknown;
                    index: number;
                  }) => React.ReactNode
                )({ item, index }),
              ),
            ),
        ListFooterComponent
          ? typeof ListFooterComponent === "function"
            ? React.createElement(
                ListFooterComponent as React.FunctionComponent,
              )
            : (ListFooterComponent as React.ReactNode)
          : null,
      );
    },
  );
  (Comp as unknown as { displayName: string }).displayName = displayName;
  return Comp;
}

export const FlatList = createFlatListMock("FlatList");

export const Modal = React.forwardRef<unknown, Record<string, unknown>>(
  ({ children, visible, testID, ...rest }, ref) =>
    visible !== false
      ? React.createElement(
          "div",
          { ref, "data-testid": testID, role: "dialog", ...rest },
          children as React.ReactNode,
        )
      : null,
);
(Modal as unknown as { displayName: string }).displayName = "Modal";

export const ActivityIndicator = React.forwardRef<
  unknown,
  Record<string, unknown>
>(({ testID, ...rest }, ref) =>
  React.createElement("span", {
    ref,
    "data-testid": testID,
    role: "progressbar",
    ...rest,
  }),
);
(ActivityIndicator as unknown as { displayName: string }).displayName =
  "ActivityIndicator";

export const KeyboardAvoidingView = mockComponent(
  "div",
  "KeyboardAvoidingView",
);

export const AccessibilityInfo = {
  announceForAccessibility: () => {},
  isScreenReaderEnabled: async () => false,
  addEventListener: () => ({ remove: () => {} }),
};

export const TouchableOpacity = mockComponent("button", "TouchableOpacity");

export const Switch = React.forwardRef<unknown, Record<string, unknown>>(
  (
    { value, onValueChange, testID, disabled, accessibilityLabel, ...rest },
    ref,
  ) =>
    React.createElement("input", {
      ref,
      type: "checkbox",
      checked: !!value,
      onChange: onValueChange
        ? () => (onValueChange as (v: boolean) => void)(!value)
        : undefined,
      disabled: disabled || undefined,
      "data-testid": testID,
      "aria-label": accessibilityLabel,
      ...rest,
    }),
);
(Switch as unknown as { displayName: string }).displayName = "Switch";

export const SafeAreaView = mockComponent("div", "SafeAreaView");

export const SectionList = React.forwardRef<unknown, Record<string, unknown>>(
  (
    { sections, renderItem, renderSectionHeader, keyExtractor, testID },
    ref,
  ) => {
    const sectionArr = Array.isArray(sections) ? sections : [];
    return React.createElement(
      "div",
      { ref, "data-testid": testID },
      sectionArr.map(
        (section: { title?: string; data: unknown[] }, sIdx: number) =>
          React.createElement(
            React.Fragment,
            { key: section.title ?? String(sIdx) },
            renderSectionHeader
              ? (
                  renderSectionHeader as (info: {
                    section: unknown;
                  }) => React.ReactNode
                )({ section })
              : null,
            section.data.map((item: unknown, iIdx: number) =>
              React.createElement(
                React.Fragment,
                {
                  key: keyExtractor
                    ? (
                        keyExtractor as (item: unknown, index: number) => string
                      )(item, iIdx)
                    : `${sIdx}-${iIdx}`,
                },
                (
                  renderItem as (info: {
                    item: unknown;
                    index: number;
                    section: unknown;
                  }) => React.ReactNode
                )({ item, index: iIdx, section }),
              ),
            ),
          ),
      ),
    );
  },
);
(SectionList as unknown as { displayName: string }).displayName = "SectionList";

export default {
  Platform,
  useColorScheme,
  StyleSheet,
  Appearance,
  Dimensions,
  Alert,
  Linking,
  NativeModules,
};
