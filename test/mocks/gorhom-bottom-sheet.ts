/* eslint-disable react/display-name */
// Mock @gorhom/bottom-sheet for recipe-builder sheet component tests.
// Renders simple HTML equivalents so render assertions work in jsdom.
import React from "react";
import { createFlatListMock } from "./react-native";

// Re-export mocked RN primitives as BottomSheet equivalents
export const BottomSheetTextInput = React.forwardRef<
  unknown,
  Record<string, unknown>
>(({ testID, onChangeText, accessibilityLabel, ...rest }, ref) =>
  React.createElement("input", {
    ref,
    "data-testid": testID,
    "aria-label": accessibilityLabel as string,
    onChange: onChangeText
      ? (e: { target: { value: string } }) =>
          (onChangeText as (v: string) => void)(e.target.value)
      : undefined,
    ...rest,
  }),
);
(BottomSheetTextInput as unknown as { displayName: string }).displayName =
  "BottomSheetTextInput";

export const BottomSheetFlatList = createFlatListMock("BottomSheetFlatList");

export const BottomSheetScrollView = React.forwardRef<
  unknown,
  Record<string, unknown>
>(({ children, testID, ...rest }, ref) =>
  React.createElement(
    "div",
    { ref, "data-testid": testID, ...rest },
    children as React.ReactNode,
  ),
);
(BottomSheetScrollView as unknown as { displayName: string }).displayName =
  "BottomSheetScrollView";

export const BottomSheetView = React.forwardRef<
  unknown,
  Record<string, unknown>
>(({ children, testID, ...rest }, ref) =>
  React.createElement(
    "div",
    { ref, "data-testid": testID, ...rest },
    children as React.ReactNode,
  ),
);
(BottomSheetView as unknown as { displayName: string }).displayName =
  "BottomSheetView";

export const BottomSheetModal = React.forwardRef<
  unknown,
  Record<string, unknown>
>(({ children, onDismiss, accessible, ...rest }, ref) => {
  React.useImperativeHandle(ref, () => ({
    present: () => {},
    dismiss: () => {
      if (typeof onDismiss === "function") {
        (onDismiss as () => void)();
      }
    },
    snapToIndex: () => {},
    close: () => {},
  }));
  // Reflect `accessible` verbatim (String() so `false` is observable, not
  // dropped as a boolean DOM attr) — lets tests pin that a sheet whose content
  // must be reachable passes accessible={false}. On iOS new-arch, gorhom's
  // default accessible=true collapses the whole subtree into one a11y leaf,
  // hiding the content from VoiceOver and Maestro (see docs/solutions/
  // logic-errors/gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md).
  return React.createElement(
    "div",
    {
      "data-testid": "bottom-sheet-modal",
      "data-accessible": String(accessible),
      ...rest,
    },
    children as React.ReactNode,
  );
});
(BottomSheetModal as unknown as { displayName: string }).displayName =
  "BottomSheetModal";

export const BottomSheetBackdrop = React.forwardRef<
  unknown,
  Record<string, unknown>
>((_props, ref) => React.createElement("div", { ref }));
(BottomSheetBackdrop as unknown as { displayName: string }).displayName =
  "BottomSheetBackdrop";

export default {};
