import React from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, withOpacity } from "@/constants/theme";

// ── Date Strip Item ──────────────────────────────────────────────────

export const DateStripItem = React.memo(function DateStripItem({
  date,
  isSelected,
  hasItems,
  onPress,
}: {
  date: Date;
  isSelected: boolean;
  hasItems: boolean;
  onPress: (date: Date) => void;
}) {
  const { theme } = useTheme();
  const dayName = date
    .toLocaleDateString("en-US", { weekday: "short" })
    .charAt(0);
  const dayNum = date.getDate();

  return (
    <PressableScale
      scaleTo={0.95}
      onPress={() => onPress(date)}
      style={[
        styles.dateStripItem,
        {
          backgroundColor: isSelected
            ? theme.accentSolid
            : withOpacity(theme.text, 0.05),
        },
      ]}
      accessibilityRole="button"
      // Selection is state, not label content — accessibilityState below is
      // what VoiceOver/TalkBack use to announce "selected"; appending it to
      // the label too caused a double announcement.
      accessibilityLabel={date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
      accessibilityState={{ selected: isSelected }}
    >
      <ThemedText
        style={[
          styles.dateStripDayName,
          { color: isSelected ? theme.buttonText : theme.textSecondary },
        ]}
      >
        {dayName}
      </ThemedText>
      <ThemedText
        style={[
          styles.dateStripDayNum,
          { color: isSelected ? theme.buttonText : theme.text },
        ]}
      >
        {dayNum}
      </ThemedText>
      {hasItems && !isSelected && (
        <View
          style={[styles.dateStripDot, { backgroundColor: theme.accentSolid }]}
        />
      )}
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  dateStripItem: {
    width: 44,
    height: 64,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dateStripDayName: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
  dateStripDayNum: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  dateStripDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
