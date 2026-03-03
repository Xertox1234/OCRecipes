import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, withOpacity } from "@/constants/theme";
import { getAppetiteLabel } from "./appetite-utils";

interface MedicationLogCardProps {
  medicationName: string;
  brandName: string | null;
  dosage: string;
  takenAt: string;
  appetiteLevel: number | null;
  sideEffects: string[];
  onPress?: () => void;
}

export default function MedicationLogCard({
  medicationName,
  brandName,
  dosage,
  takenAt,
  appetiteLevel,
  sideEffects,
  onPress,
}: MedicationLogCardProps) {
  const { theme } = useTheme();

  const date = new Date(takenAt);
  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const cardStyle = [
    styles.card,
    {
      backgroundColor: theme.backgroundSecondary,
      borderColor: theme.border,
      padding: Spacing.md,
    },
  ];

  const content = (
    <>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="medkit" size={18} color={theme.link} />
          <Text
            style={[styles.name, { color: theme.text, marginLeft: Spacing.xs }]}
          >
            {brandName || medicationName}
          </Text>
        </View>
        <Text style={[styles.date, { color: theme.textSecondary }]}>
          {dateStr} {timeStr}
        </Text>
      </View>

      <Text
        style={[
          styles.dosage,
          { color: theme.textSecondary, marginTop: Spacing.xs },
        ]}
      >
        {dosage} {brandName ? `(${medicationName})` : ""}
      </Text>

      {appetiteLevel != null && (
        <View style={[styles.row, { marginTop: Spacing.xs }]}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>
            Appetite:
          </Text>
          <Text style={[styles.value, { color: theme.text }]}>
            {getAppetiteLabel(appetiteLevel)} ({appetiteLevel}/5)
          </Text>
        </View>
      )}

      {sideEffects.length > 0 && (
        <View style={[styles.tags, { marginTop: Spacing.xs, gap: Spacing.xs }]}>
          {sideEffects.map((effect) => (
            <View
              key={effect}
              style={[
                styles.tag,
                {
                  backgroundColor: withOpacity(theme.error, 0.09),
                  borderRadius: Spacing.xs,
                  paddingHorizontal: Spacing.xs,
                  paddingVertical: 2,
                },
              ]}
            >
              <Text style={[styles.tagText, { color: theme.error }]}>
                {effect}
              </Text>
            </View>
          ))}
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityLabel={`${brandName || medicationName} ${dosage} dose`}
        accessibilityRole="button"
        style={cardStyle}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessibilityLabel={`${brandName || medicationName} ${dosage} dose`}
      style={cardStyle}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center" },
  name: { fontSize: 16, fontWeight: "600" },
  date: { fontSize: 13 },
  dosage: { fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  label: { fontSize: 13 },
  value: { fontSize: 13, fontWeight: "500" },
  tags: { flexDirection: "row", flexWrap: "wrap" },
  tag: {},
  tagText: { fontSize: 12, fontWeight: "500" },
});
