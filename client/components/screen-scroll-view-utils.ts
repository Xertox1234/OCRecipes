import type { StyleProp, ViewStyle } from "react-native";

/**
 * Merge the header inset padding with a caller-supplied contentContainerStyle.
 * The inset is placed FIRST in the array so a caller-supplied `paddingTop`
 * (if any) always wins — RN style arrays let later entries override earlier
 * ones for the same key. See docs/rules/react-native.md.
 */
export function mergeHeaderInsetStyle(
  headerInset: number,
  contentContainerStyle?: StyleProp<ViewStyle>,
): StyleProp<ViewStyle> {
  return [{ paddingTop: headerInset }, contentContainerStyle];
}
