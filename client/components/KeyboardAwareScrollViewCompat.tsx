import type { Ref } from "react";
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
  KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";

/**
 * KeyboardAwareScrollView wrapper for screens containing text inputs.
 * `ref` reaches the scroll view through the props spread (React 19).
 */
export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = "handled",
  ...props
}: KeyboardAwareScrollViewProps & { ref?: Ref<KeyboardAwareScrollViewRef> }) {
  return (
    <KeyboardAwareScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
