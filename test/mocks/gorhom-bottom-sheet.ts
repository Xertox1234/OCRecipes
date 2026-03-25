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
>(({ children, onDismiss, ...rest }, ref) => {
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
  return React.createElement(
    "div",
    { "data-testid": "bottom-sheet-modal", ...rest },
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
