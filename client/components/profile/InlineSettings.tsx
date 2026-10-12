import React from "react";
import {
  StyleSheet,
  View,
  Pressable,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import type { ThemePreference } from "@/context/ThemeContext";

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const THEME_CYCLE: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};

interface InlineSettingsProps {
  themePreference: ThemePreference;
  onThemeToggle: () => void;
  onDietaryProfile: () => void;
}

export const InlineSettings = React.memo(function InlineSettings({
  themePreference,
  onThemeToggle,
  onDietaryProfile,
}: InlineSettingsProps) {
  const { theme } = useTheme();

  const nextMode = THEME_CYCLE[themePreference];

  const handleThemeToggle = () => {
    onThemeToggle();
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(
        `Appearance changed to ${THEME_LABELS[nextMode]}`,
      );
    }
  };

  return (
    <View style={styles.container}>
      <Card elevation={1} style={styles.card}>
        <Pressable
          onPress={onDietaryProfile}
          accessibilityLabel="Dietary Profile"
          accessibilityRole="button"
          accessibilityHint="Tap to open"
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.rowLeft}>
            <Feather name="clipboard" size={20} color={theme.textSecondary} />
            <ThemedText style={styles.label}>Dietary Profile</ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={theme.textSecondary} />
        </Pressable>

        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        <Pressable
          onPress={handleThemeToggle}
          accessibilityLabel={`Appearance: ${THEME_LABELS[themePreference]}`}
          accessibilityRole="button"
          accessibilityHint={`Currently ${THEME_LABELS[themePreference]}. Tap to switch to ${THEME_LABELS[nextMode]}`}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.rowLeft}>
            <Feather
              name={
                themePreference === "dark"
                  ? "moon"
                  : themePreference === "light"
                    ? "sun"
                    : "smartphone"
              }
              size={20}
              color={theme.textSecondary}
            />
            <ThemedText style={styles.label}>Appearance</ThemedText>
          </View>
          <ThemedText style={[styles.value, { color: theme.textSecondary }]}>
            {THEME_LABELS[themePreference]}
          </ThemedText>
        </Pressable>
      </Card>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
  },
  card: {
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // No horizontal padding of its own: Card already insets its content by
    // Spacing.xl, and adding Spacing.lg on top doubled the gutter (QA #62).
    paddingVertical: Spacing.md,
    minHeight: 48,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  label: {
    fontSize: 15,
  },
  value: {
    fontSize: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
