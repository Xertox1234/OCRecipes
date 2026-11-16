import React from "react";
import {
  StyleSheet,
  View,
  Pressable,
  AccessibilityInfo,
  Platform,
  Switch,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, withOpacity } from "@/constants/theme";
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

/** The "Plan for my family" switch and its "Family" link; see `useFamilySwitch`. */
export interface FamilySettings {
  /** False while the plan is unknown: no row at all. */
  visible: boolean;
  value: boolean;
  /** True while a change is saving. */
  disabled: boolean;
  onToggle: (next: boolean) => void;
  showFamilyRow: boolean;
  onOpenProfiles: () => void;
}

interface InlineSettingsProps {
  themePreference: ThemePreference;
  onThemeToggle: () => void;
  onDietaryProfile: () => void;
  family?: FamilySettings;
}

export const InlineSettings = React.memo(function InlineSettings({
  themePreference,
  onThemeToggle,
  onDietaryProfile,
  family,
}: InlineSettingsProps) {
  const { theme } = useTheme();

  const nextMode = THEME_CYCLE[themePreference];

  const handleThemeToggle = () => {
    onThemeToggle();
    // Ungated: the row has no live region, so Android needs this too.
    AccessibilityInfo.announceForAccessibility(
      `Appearance changed to ${THEME_LABELS[nextMode]}`,
    );
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

        {family?.visible ? (
          <>
            {/* Layout only: the Switch below is the accessible control, as on
                the Coach reminders screen. */}
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Feather name="users" size={20} color={theme.textSecondary} />
                <ThemedText style={styles.label}>Plan for my family</ThemedText>
              </View>
              <Switch
                testID="family-planning-switch"
                accessibilityRole="switch"
                accessibilityLabel="Plan for my family"
                accessibilityHint="Plan meals for other people in your household"
                accessibilityState={{
                  checked: family.value,
                  disabled: family.disabled,
                }}
                value={family.value}
                onValueChange={family.onToggle}
                disabled={family.disabled}
                trackColor={{
                  false: withOpacity(theme.textSecondary, 0.3),
                  true: theme.link,
                }}
                thumbColor={
                  Platform.OS === "android" ? "#FFFFFF" : undefined // hardcoded
                }
              />
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            {family.showFamilyRow ? (
              <>
                <Pressable
                  onPress={family.onOpenProfiles}
                  accessibilityLabel="Family"
                  accessibilityRole="button"
                  accessibilityHint="Tap to open"
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <Feather
                      name="user-plus"
                      size={20}
                      color={theme.textSecondary}
                    />
                    <ThemedText style={styles.label}>Family</ThemedText>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={theme.textSecondary}
                  />
                </Pressable>
                <View
                  style={[styles.divider, { backgroundColor: theme.border }]}
                />
              </>
            ) : null}
          </>
        ) : null}

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
