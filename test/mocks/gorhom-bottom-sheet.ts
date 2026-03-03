/* eslint-disable react/display-name */
// Mock @gorhom/bottom-sheet for recipe-builder sheet component tests.
// Renders simple HTML equivalents so render assertions work in jsdom.
import React from "react";
import { createFlatListMock } from "./react-native";

// Re-export mocked RN primitives as BottomSheet equivalents
export const BottomSheetTextInput = React.forwardRef<
  unknown,
  Record<string, unknown>
>(({ testID, ...rest }, ref) =>
  React.createElement("input", { ref, "data-testid": testID, ...rest }),
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

export default {};
