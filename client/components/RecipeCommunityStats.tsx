import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useRecipeCommunityStats } from "@/hooks/useRecipeCommunity";
import {
  favouritedRowValue,
  triedRowValue,
  variantsRowValue,
} from "@/components/recipe-community-stats-utils";
import { Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

interface Props {
  recipeId: number;
  recipeTitle: string;
  onRemix: () => void;
}

type NavProp = NativeStackNavigationProp<RootStackParamList>;

/**
 * "Community" list rows for a public community recipe. Renders only while
 * the stats request succeeds — the server 404s non-public recipes, and a
 * failed refetch must hide the section rather than freeze stale counts.
 */
export function RecipeCommunityStats({
  recipeId,
  recipeTitle,
  onRemix,
}: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<NavProp>();
  const stats = useRecipeCommunityStats(recipeId, true);

  if (stats.isPending) {
    return (
      <Card
        elevation={1}
        style={styles.section}
        accessibilityLabel="Loading community stats"
      >
        <SkeletonBox width={120} height={18} />
        {[0, 1, 2].map((i) => (
          <SkeletonBox key={i} height={20} style={styles.skeletonRow} />
        ))}
      </Card>
    );
  }
  if (!stats.isSuccess) return null;

  const { triedCount, favouritedCount, variantCount } = stats.data;
  const zeroStyle = { color: theme.link };

  const onVariants = () => {
    haptics.selection();
    if (variantCount === 0) {
      onRemix();
      return;
    }
    navigation.navigate("RecipeVariants", { recipeId, title: recipeTitle });
  };

  return (
    <Card elevation={1} style={styles.section}>
      <ThemedText type="h4" style={styles.heading}>
        Community
      </ThemedText>

      <View
        style={[styles.row, { borderBottomColor: theme.border }]}
        accessible
        accessibilityLabel={`Tried it, ${triedRowValue(triedCount)}`}
      >
        <View style={styles.label}>
          <Feather name="check-circle" size={16} color={theme.textSecondary} />
          <ThemedText>Tried it</ThemedText>
        </View>
        <ThemedText style={triedCount === 0 ? zeroStyle : styles.value}>
          {triedRowValue(triedCount)}
        </ThemedText>
      </View>

      <View
        style={[styles.row, { borderBottomColor: theme.border }]}
        accessible
        accessibilityLabel={`Favourited, ${favouritedRowValue(favouritedCount)}`}
      >
        <View style={styles.label}>
          <Ionicons
            name="heart-outline"
            size={16}
            color={theme.textSecondary}
          />
          <ThemedText>Favourited</ThemedText>
        </View>
        <ThemedText style={favouritedCount === 0 ? zeroStyle : styles.value}>
          {favouritedRowValue(favouritedCount)}
        </ThemedText>
      </View>

      {/* Full-width row: pressed-opacity feedback (house rule for rows; see PressableScale). */}
      <Pressable
        onPress={onVariants}
        style={({ pressed }) => [
          styles.row,
          styles.lastRow,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          variantCount === 0
            ? "Community variants, none yet. Remix this recipe"
            : `Community variants, ${variantCount}`
        }
        accessibilityHint={
          variantCount === 0 ? undefined : "Shows the list of community remixes"
        }
      >
        <View style={styles.label}>
          <Ionicons
            name="shuffle-outline"
            size={16}
            color={theme.textSecondary}
          />
          <ThemedText>Community variants</ThemedText>
        </View>
        <View style={styles.label}>
          <ThemedText style={variantCount === 0 ? zeroStyle : styles.value}>
            {variantsRowValue(variantCount)}
          </ThemedText>
          <Feather name="chevron-right" size={16} color={theme.textSecondary} />
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    // Boxed like Tips and Ask Coach (AskCoachSection) so the three sections
    // share one inset.
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  heading: {
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  value: {
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.6,
  },
  skeletonRow: {
    marginTop: Spacing.sm,
  },
});
