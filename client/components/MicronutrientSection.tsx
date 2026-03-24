import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";

export interface MicronutrientData {
  nutrientName: string;
  amount: number;
  unit: string;
  percentDailyValue: number;
}

interface MicronutrientSectionProps {
  micronutrients: MicronutrientData[];
  isLoading?: boolean;
  reducedMotion?: boolean;
}

/**
 * Splits micronutrients into vitamins and minerals groups.
 * Vitamins: names starting with "Vitamin" or "Folate".
 * Minerals: everything else.
 */
export function classifyMicronutrients(data: MicronutrientData[]): {
  vitamins: MicronutrientData[];
  minerals: MicronutrientData[];
} {
  const vitamins: MicronutrientData[] = [];
  const minerals: MicronutrientData[] = [];

  for (const item of data) {
    const name = item.nutrientName.trim();
    if (name.startsWith("Vitamin") || name === "Folate") {
      vitamins.push(item);
    } else {
      minerals.push(item);
    }
  }

  return { vitamins, minerals };
}

/**
 * Returns the appropriate color for a daily value percentage.
 * Green for >50%, yellow/warning for 25-50%, gray/muted for <25%.
 */
export function getDVColor(
  percentDV: number,
  theme: { success: string; warning: string; textSecondary: string },
): string {
  if (percentDV > 50) {
    return theme.success;
  }
  if (percentDV >= 25) {
    return theme.warning;
  }
  return theme.textSecondary;
}

function NutrientRow({
  nutrient,
  theme,
}: {
  nutrient: MicronutrientData;
  theme: {
    success: string;
    warning: string;
    textSecondary: string;
    backgroundTertiary: string;
  };
}) {
  const color = getDVColor(nutrient.percentDailyValue, theme);
  const barWidth = Math.min(nutrient.percentDailyValue, 100);

  return (
    <View style={styles.nutrientRow}>
      <View style={styles.nutrientInfo}>
        <ThemedText type="small" style={styles.nutrientName}>
          {nutrient.nutrientName}
        </ThemedText>
        <ThemedText
          type="caption"
          style={[styles.nutrientAmount, { color: theme.textSecondary }]}
        >
          {nutrient.amount}
          {nutrient.unit}
        </ThemedText>
      </View>
      <View style={styles.barContainer}>
        <View
          style={[
            styles.barTrack,
            { backgroundColor: theme.backgroundTertiary },
          ]}
        >
          <View
            style={[
              styles.barFill,
              { width: `${barWidth}%`, backgroundColor: color },
            ]}
          />
        </View>
        <ThemedText type="caption" style={[styles.dvText, { color }]}>
          {nutrient.percentDailyValue}%
        </ThemedText>
      </View>
    </View>
  );
}

function NutrientGroup({
  title,
  nutrients,
  theme,
}: {
  title: string;
  nutrients: MicronutrientData[];
  theme: {
    success: string;
    warning: string;
    textSecondary: string;
    backgroundTertiary: string;
  };
}) {
  if (nutrients.length === 0) {
    return null;
  }

  return (
    <View style={styles.group}>
      <ThemedText
        type="small"
        style={[styles.groupTitle, { color: theme.textSecondary }]}
      >
        {title}
      </ThemedText>
      {nutrients.map((nutrient) => (
        <NutrientRow
          key={nutrient.nutrientName}
          nutrient={nutrient}
          theme={theme}
        />
      ))}
    </View>
  );
}

export function MicronutrientSection({
  micronutrients,
  isLoading,
  reducedMotion: reducedMotionProp,
}: MicronutrientSectionProps) {
  const { theme } = useTheme();
  const { reducedMotion: systemReducedMotion } = useAccessibility();
  const reducedMotion = reducedMotionProp ?? systemReducedMotion;

  const [isExpanded, setIsExpanded] = useState(false);
  const chevronRotation = useSharedValue(-90);
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isExpanded,
    reducedMotion,
  );

  React.useEffect(() => {
    if (reducedMotion) {
      chevronRotation.value = isExpanded ? 0 : -90;
    } else {
      chevronRotation.value = withTiming(
        isExpanded ? 0 : -90,
        isExpanded ? expandTimingConfig : collapseTimingConfig,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable ref
  }, [isExpanded, reducedMotion]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const handleToggle = () => {
    setIsExpanded((prev) => !prev);
  };

  const { vitamins, minerals } = classifyMicronutrients(micronutrients);
  const nutrientCount = micronutrients.length;

  return (
    <Card>
      <Pressable
        onPress={handleToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`Micronutrients section, ${nutrientCount} nutrients`}
        accessibilityState={{ expanded: isExpanded }}
        accessibilityHint={`Double tap to ${isExpanded ? "collapse" : "expand"} micronutrients`}
      >
        <View style={styles.headerLeft}>
          <ThemedText type="h4">Micronutrients</ThemedText>
          <ThemedText
            type="caption"
            style={[styles.countText, { color: theme.textSecondary }]}
          >
            {nutrientCount} nutrient{nutrientCount !== 1 ? "s" : ""}
          </ThemedText>
        </View>
        <Animated.View style={chevronStyle}>
          <Feather
            name="chevron-down"
            size={20}
            color={theme.textSecondary}
            accessible={false}
          />
        </Animated.View>
      </Pressable>

      <Animated.View style={animatedStyle}>
        <View onLayout={onContentLayout}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={theme.textSecondary} />
            </View>
          ) : micronutrients.length === 0 ? (
            <View style={styles.emptyContainer}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Micronutrient data not available for this item
              </ThemedText>
            </View>
          ) : (
            <View style={styles.content}>
              <NutrientGroup
                title="Vitamins"
                nutrients={vitamins}
                theme={theme}
              />
              <NutrientGroup
                title="Minerals"
                nutrients={minerals}
                theme={theme}
              />
            </View>
          )}
        </View>
      </Animated.View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 44,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
  },
  countText: {
    fontFamily: FontFamily.regular,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.lg,
  },
  group: {
    gap: Spacing.sm,
  },
  groupTitle: {
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  nutrientRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  nutrientInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
  },
  nutrientName: {
    fontFamily: FontFamily.medium,
  },
  nutrientAmount: {
    fontFamily: FontFamily.regular,
  },
  barContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    width: 120,
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: BorderRadius.full,
  },
  dvText: {
    width: 36,
    textAlign: "right",
    fontFamily: FontFamily.medium,
  },
  loadingContainer: {
    paddingVertical: Spacing["2xl"],
    alignItems: "center",
  },
  emptyContainer: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
});
