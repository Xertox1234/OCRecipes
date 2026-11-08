import React from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { PressableScale } from "@/components/PressableScale";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Shadows, Spacing } from "@/constants/theme";
import { jumpToLatestFadeMs } from "@/constants/animations";

interface JumpToLatestButtonProps {
  visible: boolean;
  onPress: () => void;
}

/**
 * A small round "jump to latest" control floated over the bottom of the
 * chat list. Shown when the user has scrolled up away from the newest
 * message (`useStickToBottom`), so a reply streaming in doesn't drag them
 * down — they come back when they choose to. Its parent must be the list's
 * container, which it is positioned against.
 */
export function JumpToLatestButton({
  visible,
  onPress,
}: JumpToLatestButtonProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

  if (!visible) return null;

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(jumpToLatestFadeMs)}
      exiting={reducedMotion ? undefined : FadeOut.duration(jumpToLatestFadeMs)}
      style={styles.anchor}
      pointerEvents="box-none"
    >
      <PressableScale
        onPress={onPress}
        scaleTo={0.92}
        accessibilityRole="button"
        accessibilityLabel="Jump to latest message"
        style={[
          styles.button,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Ionicons
          name="arrow-down"
          size={20}
          color={theme.text}
          accessible={false}
        />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    bottom: Spacing.md,
    alignSelf: "center",
  },
  // A real 44pt target (not hitSlop, which Android clips to the parent).
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.small,
  },
});
