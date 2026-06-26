import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";

export function RecipeSearchEntry() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();

  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        // RecipeBrowserModal lives on RootStack; HomeScreenNavigationProp is a
        // 3-level composite (HomeStack → MainTab → RootStack) so navigate()
        // reaches it directly — no getParent() needed.
        navigation.navigate("RecipeBrowserModal");
      }}
      accessibilityRole="button"
      accessibilityLabel="Search recipes"
      accessibilityHint="Opens recipe search and discovery"
      style={({ pressed }) => [
        styles.bar,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: theme.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Feather
        name="search"
        size={18}
        color={theme.textSecondary}
        accessible={false}
      />
      <ThemedText type="body" style={{ color: theme.textSecondary }}>
        Search recipes…
      </ThemedText>
      <View style={styles.spacer} />
      <Feather
        name="chevron-right"
        size={18}
        color={withOpacity(theme.text, 0.4)}
        accessible={false}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  spacer: {
    flex: 1,
  },
});
