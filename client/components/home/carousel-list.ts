import { StyleSheet } from "react-native";

import { Spacing, FontFamily } from "@/constants/theme";

/**
 * The horizontal FlatList props the home carousels share. Spread it, then add
 * each carousel's own `snapToInterval`, `getItemLayout` and data props.
 */
export const HORIZONTAL_CAROUSEL_LIST_PROPS = {
  horizontal: true,
  showsHorizontalScrollIndicator: false,
  decelerationRate: "fast",
  windowSize: 5,
  // Clipping detaches off-screen cards from the native tree, so VoiceOver
  // (and TalkBack) can't move past the second card. Explicit false:
  // FlatList's default clips on Android.
  removeClippedSubviews: false,
} as const;

/** Section shell styles shared by the home carousels. */
export const carouselStyles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  header: {
    fontFamily: FontFamily.semiBold,
    fontSize: 17,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
});
