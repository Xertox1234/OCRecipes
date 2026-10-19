import React, { useCallback } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  LIBRARY_ITEMS,
  libraryTileLabel,
  navigateLibraryItem,
  type LibraryItem,
} from "@/components/profile/library-config";
import type { LibraryCountsResponse } from "@shared/schemas/profile-hub";
import type { ProfileScreenNavigationProp } from "@/types/navigation";

interface LibraryGridProps {
  counts: LibraryCountsResponse;
  onLockedPress: () => void;
}

const LibraryCard = React.memo(function LibraryCard({
  item,
  count,
  locked,
  onItemPress,
}: {
  item: LibraryItem;
  count: number;
  locked: boolean;
  onItemPress: (item: LibraryItem) => void;
}) {
  const { theme } = useTheme();
  const handlePress = useCallback(() => onItemPress(item), [onItemPress, item]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={libraryTileLabel(item.label, count, locked)}
      accessibilityHint={
        locked
          ? "Opens upgrade screen"
          : `Opens your ${item.label.toLowerCase()}`
      }
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: withOpacity(theme.border, 0.5),
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.cardTop}>
        <Feather name={item.icon} size={22} color={theme.textSecondary} />
        {locked && (
          <View
            importantForAccessibility="no-hide-descendants"
            accessible={false}
          >
            <Feather name="lock" size={14} color={theme.textSecondary} />
          </View>
        )}
      </View>
      <View style={styles.cardBottom}>
        <ThemedText style={[styles.cardLabel, { color: theme.textSecondary }]}>
          {item.label}
        </ThemedText>
        <ThemedText style={[styles.cardCount, { color: theme.text }]}>
          {count}
        </ThemedText>
      </View>
    </Pressable>
  );
});

export const LibraryGrid = React.memo(function LibraryGrid({
  counts,
  onLockedPress,
}: LibraryGridProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const pantryUnlocked = usePremiumFeature("pantryTracking");

  const handlePress = useCallback(
    (item: LibraryItem) => {
      haptics.selection();
      const locked = item.premiumKey && !pantryUnlocked;
      if (locked) {
        onLockedPress();
        return;
      }
      navigateLibraryItem(item.id, navigation);
    },
    [haptics, navigation, pantryUnlocked, onLockedPress],
  );

  // Render in rows of 2
  const rows: LibraryItem[][] = [];
  for (let i = 0; i < LIBRARY_ITEMS.length; i += 2) {
    rows.push(LIBRARY_ITEMS.slice(i, i + 2) as LibraryItem[]);
  }

  return (
    <View style={styles.container}>
      <View accessibilityRole="header">
        <ThemedText
          style={[styles.sectionHeader, { color: theme.textSecondary }]}
        >
          Your Library
        </ThemedText>
      </View>

      <View
        role="group"
        accessibilityLabel={`Your Library, ${LIBRARY_ITEMS.length} items`}
        style={styles.grid}
      >
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.gridRow}>
            {row.map((item) => {
              const locked = !!item.premiumKey && !pantryUnlocked;
              return (
                <LibraryCard
                  key={item.id}
                  item={item}
                  count={counts[item.countKey]}
                  locked={locked}
                  onItemPress={handlePress}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
  },
  sectionHeader: {
    fontSize: 13,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
  },
  grid: {
    gap: Spacing.md,
  },
  gridRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  card: {
    flex: 1,
    height: 72,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    justifyContent: "space-between",
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  cardLabel: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
  cardCount: {
    fontSize: 20,
    fontFamily: FontFamily.semiBold,
  },
});
