import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ActionRowProps {
  icon: string;
  label: string;
  onPress: () => void;
  subtitle?: string;
  isLocked?: boolean;
}

export const ActionRow = React.memo(function ActionRow({
  icon,
  label,
  onPress,
  subtitle,
  isLocked,
}: ActionRowProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);
  const isCard = !!subtitle;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        if (!reducedMotion) {
          scale.value = withSpring(0.97, pressSpringConfig);
        }
      }}
      onPressOut={() => {
        if (!reducedMotion) {
          scale.value = withSpring(1, pressSpringConfig);
        }
      }}
      accessibilityRole="button"
      accessibilityLabel={isLocked ? `${label} (Premium)` : label}
      accessibilityHint={subtitle}
      style={[
        isCard
          ? [styles.card, { backgroundColor: theme.backgroundSecondary }]
          : styles.row,
        animatedStyle,
      ]}
    >
      <View
        style={[
          isCard ? styles.iconCircleLarge : styles.iconCircle,
          { backgroundColor: withOpacity(theme.link, 0.1) },
        ]}
      >
        <Feather
          name={icon as keyof typeof Feather.glyphMap}
          size={isCard ? 20 : 18}
          color={theme.link}
          accessible={false}
        />
        {isLocked && (
          <View
            style={[
              styles.lockBadge,
              { backgroundColor: theme.backgroundRoot },
            ]}
          >
            <Feather
              name="lock"
              size={10}
              color={theme.textSecondary}
              accessible={false}
            />
          </View>
        )}
      </View>
      <View style={styles.textContainer}>
        <ThemedText
          type="body"
          style={isCard ? styles.cardLabel : undefined}
          numberOfLines={1}
        >
          {label}
        </ThemedText>
        {subtitle && (
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary }}
            numberOfLines={1}
          >
            {subtitle}
          </ThemedText>
        )}
      </View>
      <Feather
        name="chevron-right"
        size={16}
        color={theme.textSecondary}
        accessible={false}
      />
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 48,
    gap: Spacing.md,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  iconCircleLarge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  lockBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  cardLabel: {
    fontFamily: FontFamily.medium,
  },
});
