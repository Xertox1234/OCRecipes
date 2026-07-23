import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";

const FIELD_LABEL: Record<string, string> = {
  calories: "Calories",
  sugar: "Sugar (g)",
  fat: "Fat (g)",
};

type Source = "database" | "label";
type NutritionLike = Record<string, number | string | undefined>;

export function ScanConflictPrompt(props: {
  conflictFields: string[];
  labelNutrition: NutritionLike;
  dbNutrition: NutritionLike;
  activeSource: Source;
  onChoose: (s: Source) => void;
}) {
  const { theme } = useTheme();
  const {
    conflictFields,
    labelNutrition,
    dbNutrition,
    activeSource,
    onChoose,
  } = props;

  const Column = ({
    source,
    title,
    data,
  }: {
    source: Source;
    title: string;
    data: NutritionLike;
  }) => {
    const selected = activeSource === source;
    const rows = conflictFields
      .map((f) => `${FIELD_LABEL[f] ?? f} ${data[f] ?? "—"}`)
      .join(", ");
    return (
      <Pressable
        onPress={() => onChoose(source)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`Use ${title}: ${rows}. ${selected ? "Selected" : "Not selected"}`}
        style={[
          styles.col,
          {
            borderColor: selected ? theme.link : theme.border,
            backgroundColor: selected
              ? withOpacity(theme.link, 0.1)
              : theme.backgroundDefault,
          },
        ]}
      >
        <Text style={[styles.colTitle, { color: theme.text }]}>{title}</Text>
        {conflictFields.map((f) => (
          <Text key={f} style={{ color: theme.textSecondary }}>
            {FIELD_LABEL[f] ?? f}:{" "}
            <Text style={{ color: theme.text }}>{String(data[f] ?? "—")}</Text>
          </Text>
        ))}
      </Pressable>
    );
  };

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface }]}
      accessibilityRole="summary"
      accessibilityLabel="The scanned label differs from our database. Choose which to use."
    >
      <Text style={[styles.heading, { color: theme.text }]}>
        The label you scanned differs from our database
      </Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        <Column
          source="label"
          title="Label (your photo)"
          data={labelNutrition}
        />
        <Column source="database" title="Database" data={dbNutrition} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  heading: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12 },
  col: { flex: 1, borderWidth: 2, borderRadius: 10, padding: 12, gap: 4 },
  colTitle: { fontWeight: "600", marginBottom: 4 },
});
