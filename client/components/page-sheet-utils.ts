import { Platform } from "react-native";
import { Spacing } from "@/constants/theme";

/**
 * Top padding for the header of a `<Modal presentationStyle="pageSheet">`.
 * iOS lays the sheet out as a card below the status bar. Android ignores
 * pageSheet and opens a full, edge-to-edge window (mandatory on Android 16),
 * so the header starts under the status bar unless it adds the inset.
 */
export function pageSheetHeaderPaddingTop(
  insetTop: number,
  os: typeof Platform.OS = Platform.OS,
): number {
  return Spacing.lg + (os === "android" ? insetTop : 0);
}
