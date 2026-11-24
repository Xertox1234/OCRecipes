import React from "react";
import { StyleSheet, View } from "react-native";
import { Chip } from "@/components/Chip";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { allergySeverities } from "@shared/constants/allergens";
import {
  allergenWord,
  type AllergyCardEdits,
  type AllergyCardPayload,
} from "@shared/schemas/coach-write-cards";

interface Props {
  payload: AllergyCardPayload;
  edits: AllergyCardEdits;
  onEdit: (e: AllergyCardEdits) => void;
}

const SEVERITY_LABEL = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
} as const;

/**
 * The allergy card's controls (Coach roadmap T1): the allergen the Coach
 * heard, and the severity, which only the user chooses. The card cannot be
 * saved until one is picked.
 */
export function AllergyWriteCard({ payload, edits, onEdit }: Props) {
  const { theme } = useTheme();
  const question = "How severe is it?";

  return (
    <View>
      <ThemedText type="body">
        Add {allergenWord(payload.allergen)} to your allergies
      </ThemedText>
      <View
        style={styles.group}
        accessibilityRole="radiogroup"
        accessibilityLabel={question}
      >
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {question}
        </ThemedText>
        <View style={styles.chips}>
          {allergySeverities.map((severity) => (
            <Chip
              key={severity}
              label={SEVERITY_LABEL[severity]}
              variant="filter"
              selected={edits.severity === severity}
              accessibilityRole="radio"
              style={styles.chip}
              onPress={() => onEdit({ ...edits, severity })}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: Spacing.sm, gap: Spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: { minHeight: 44, justifyContent: "center" },
});
