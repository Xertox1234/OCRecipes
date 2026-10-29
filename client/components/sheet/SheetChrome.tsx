import React from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

// Shared chrome for the meal-plan bottom sheets. These render NO
// accessibilityViewIsModal / accessible wrappers: each sheet keeps its own
// modal root (BottomSheetModal never forwards the prop) so the gorhom
// a11y-subtree handling stays with the sheet.

export function SheetDragHandle() {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.dragIndicator,
        { backgroundColor: withOpacity(theme.text, 0.2) },
      ]}
    />
  );
}

interface SheetHeaderProps {
  title: string;
  onDone: () => void;
}

/** Drag handle + title row with a "Done" control (labelled "Close"). */
export function SheetHeader({ title, onDone }: SheetHeaderProps) {
  const { theme } = useTheme();
  return (
    <View style={styles.header}>
      <SheetDragHandle />
      <View style={styles.headerRow}>
        <ThemedText style={styles.headerTitle}>{title}</ThemedText>
        <Pressable
          onPress={onDone}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <ThemedText style={[styles.doneText, { color: theme.link }]}>
            Done
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

interface SheetOptionRowProps {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  description: string;
  onPress: () => void;
  accessibilityLabel: string;
  /** Defaults to a chevron; ImportRecipeSheet swaps in a lock. */
  trailingIcon?: React.ComponentProps<typeof Feather>["name"];
}

/** Icon / title / description / trailing-icon tappable row. */
export function SheetOptionRow({
  icon,
  title,
  description,
  onPress,
  accessibilityLabel,
  trailingIcon = "chevron-right",
}: SheetOptionRowProps) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.optionRow,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Feather name={icon} size={20} color={theme.link} />
      <View style={styles.optionText}>
        <ThemedText style={styles.optionTitle}>{title}</ThemedText>
        <ThemedText style={[styles.optionDesc, { color: theme.textSecondary }]}>
          {description}
        </ThemedText>
      </View>
      <Feather name={trailingIcon} size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    paddingTop: Spacing.sm,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
  },
  doneText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    gap: Spacing.md,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  optionDesc: {
    fontSize: 13,
    marginTop: 2,
  },
});
