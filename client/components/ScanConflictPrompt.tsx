import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";
import type { NutritionData } from "@/hooks/useNutritionLookup";

const FIELD_LABEL: Record<string, string> = {
  calories: "Calories",
  sugar: "Sugar (g)",
  fat: "Fat (g)",
};

type Source = "database" | "label";

// Hoisted to module scope (not defined inside ScanConflictPrompt's body) so it
// keeps a stable component identity across renders — an in-body definition
// would get a new identity every render, causing React to unmount/remount
// both radio Pressables on every chooseSource tap and drop VoiceOver/TalkBack
// focus on the very interaction this component handles.
function Column({
  theme,
  onChoose,
  activeSource,
  conflictFields,
  source,
  title,
  data,
}: {
  theme: ReturnType<typeof useTheme>["theme"];
  onChoose: (s: Source) => void;
  activeSource: Source;
  conflictFields: string[];
  source: Source;
  title: string;
  data: NutritionData;
}) {
  const selected = activeSource === source;
  const rows = conflictFields
    .map(
      (f) => `${FIELD_LABEL[f] ?? f} ${data[f as keyof NutritionData] ?? "—"}`,
    )
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
      <View style={styles.colTitleRow}>
        <Text
          style={{
            color: theme.text,
            fontWeight: selected ? "700" : "400",
          }}
        >
          {title}
        </Text>
        {selected ? (
          <Feather
            name="check-circle"
            size={16}
            color={theme.link}
            accessible={false}
          />
        ) : null}
      </View>
      {conflictFields.map((f) => (
        <Text key={f} style={{ color: theme.textSecondary }}>
          {FIELD_LABEL[f] ?? f}:{" "}
          <Text style={{ color: theme.text }}>
            {String(data[f as keyof NutritionData] ?? "—")}
          </Text>
        </Text>
      ))}
    </Pressable>
  );
}

export function ScanConflictPrompt(props: {
  conflictFields: string[];
  labelNutrition: NutritionData;
  dbNutrition: NutritionData;
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

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <Text style={[styles.heading, { color: theme.text }]}>
        The label you scanned differs from our database
      </Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        <Column
          theme={theme}
          onChoose={onChoose}
          activeSource={activeSource}
          conflictFields={conflictFields}
          source="label"
          title="Label (your photo)"
          data={labelNutrition}
        />
        <Column
          theme={theme}
          onChoose={onChoose}
          activeSource={activeSource}
          conflictFields={conflictFields}
          source="database"
          title="Database"
          data={dbNutrition}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  heading: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12 },
  col: { flex: 1, borderWidth: 2, borderRadius: 10, padding: 12, gap: 4 },
  colTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
});
