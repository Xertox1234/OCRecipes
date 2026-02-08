import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily, withOpacity } from "@/constants/theme";

interface SheetHeaderProps {
  title: string;
  onDone: () => void;
}

function SheetHeaderInner({ title, onDone }: SheetHeaderProps) {
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.dragIndicator,
          { backgroundColor: withOpacity(theme.text, 0.2) },
        ]}
      />
      <View style={styles.header}>
        <ThemedText style={[styles.title, { color: theme.text }]}>
          {title}
        </ThemedText>
        <Pressable
          onPress={onDone}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Done editing ${title}`}
        >
          <ThemedText style={[styles.doneText, { color: theme.link }]}>
            Done
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

export const SheetHeader = React.memo(SheetHeaderInner);

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingTop: Spacing.sm,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
  },
  doneText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
