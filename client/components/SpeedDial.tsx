import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  Shadows,
  FAB_SIZE,
  TAB_BAR_HEIGHT,
  withOpacity,
} from "@/constants/theme";
import { speedDialStaggerDelay } from "@/constants/animations";

interface SpeedDialAction {
  icon: string;
  label: string;
  onPress: () => void;
}

interface SpeedDialProps {
  actions: SpeedDialAction[];
  onClose: () => void;
}

export function SpeedDial({ actions, onClose }: SpeedDialProps) {
  const { theme, isDark } = useTheme();
  const { reducedMotion } = useAccessibility();

  const backdropEntering = reducedMotion ? undefined : FadeIn.duration(200);

  return (
    <View style={styles.wrapper} accessibilityViewIsModal>
      <Animated.View
        entering={backdropEntering}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={isDark ? 30 : 40}
            tint={isDark ? "dark" : "light"}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: withOpacity("#000000", 0.2) }, // hardcoded — backdrop overlay is always black
            ]}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: withOpacity("#000000", 0.4) }, // hardcoded — backdrop overlay is always black
            ]}
          />
        )}
      </Animated.View>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close speed dial"
      />
      <View
        style={[
          styles.actionsContainer,
          { bottom: TAB_BAR_HEIGHT + Spacing.lg + FAB_SIZE + Spacing.md },
        ]}
      >
        {actions.map((action, index) => {
          const reverseIndex = actions.length - 1 - index;
          const entering = reducedMotion
            ? undefined
            : FadeInUp.springify()
                .damping(16)
                .stiffness(180)
                .delay(reverseIndex * speedDialStaggerDelay);

          return (
            <Animated.View
              key={action.label}
              entering={entering}
              style={styles.actionRow}
            >
              <View
                style={[
                  styles.labelContainer,
                  { backgroundColor: theme.backgroundDefault },
                  Shadows.small,
                ]}
              >
                <ThemedText
                  type="small"
                  style={[styles.label, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {action.label}
                </ThemedText>
              </View>
              <Pressable
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => [
                  styles.miniFab,
                  Shadows.medium,
                  {
                    backgroundColor: theme.accentSolid,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Feather
                  name={action.icon as keyof typeof Feather.glyphMap}
                  size={20}
                  color={theme.buttonText}
                  accessible={false}
                />
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const MINI_FAB_SIZE = 44;

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  actionsContainer: {
    position: "absolute",
    right: Spacing.xl,
    alignItems: "flex-end",
    gap: Spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  labelContainer: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  label: {
    fontFamily: FontFamily.medium,
  },
  miniFab: {
    width: MINI_FAB_SIZE,
    height: MINI_FAB_SIZE,
    borderRadius: MINI_FAB_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
});
