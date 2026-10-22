import React, { forwardRef } from "react";
import type { StyleProp, TextStyle } from "react-native";
import type { TextInput } from "react-native-gesture-handler";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import Animated from "react-native-reanimated";

import { useFocusBorder } from "./useFocusBorder";

type SheetInputProps = React.ComponentProps<typeof BottomSheetTextInput>;

// Keep gorhom's component as the actual input — it tracks keyboard focus for
// the sheet. Reanimated 4.3 types createAnimatedComponent loosely, so restore
// the original props/ref.
const AnimatedSheetInput = Animated.createAnimatedComponent(
  BottomSheetTextInput,
) as unknown as typeof BottomSheetTextInput;

interface FocusBottomSheetTextInputProps
  extends Omit<SheetInputProps, "style"> {
  style?: StyleProp<TextStyle>;
}

/**
 * `BottomSheetTextInput` with the shared focus feedback — the sibling of
 * `FocusTextInput` for inputs inside a gorhom bottom sheet.
 */
export const FocusBottomSheetTextInput = forwardRef<
  TextInput,
  FocusBottomSheetTextInputProps
>(({ style, onFocus, onBlur, ...props }, ref) => {
  const focus = useFocusBorder(style, onFocus, onBlur);
  return (
    <AnimatedSheetInput
      ref={ref}
      {...props}
      style={focus.focusStyle as StyleProp<TextStyle>}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
    />
  );
});

FocusBottomSheetTextInput.displayName = "FocusBottomSheetTextInput";
