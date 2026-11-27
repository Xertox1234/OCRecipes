import React from "react";
import { StyleSheet, View } from "react-native";
import { Chip } from "@/components/Chip";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { COMMON_ALLERGENS } from "@/constants/dietary-options";
import { allergySeverities } from "@shared/constants/allergens";
import type {
  FamilyCardEdits,
  FamilyCardPayload,
} from "@shared/schemas/coach-write-cards";

interface Props {
  payload: FamilyCardPayload;
  edits: FamilyCardEdits;
  onEdit: (e: FamilyCardEdits) => void;
}

const SEVERITY_LABEL = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
} as const;

/** "Dairy/Milk" for `milk`: the name the Family editor shows. */
const allergenLabel = (id: string) =>
  COMMON_ALLERGENS.find((a) => a.id === id)?.name ?? id;

/**
 * The family card's controls (Coach roadmap A3; owner ruling 2026-11-27):
 * the person the Coach heard, and for each allergy a severity only the user
 * chooses, as on the allergy card. The card cannot be saved until every one
 * is picked.
 */
export function FamilyWriteCard({ payload, edits, onEdit }: Props) {
  const { theme } = useTheme();
  const severities = payload.allergens.map(
    (_, i) => edits.severities?.[i] ?? null,
  );
  const left = severities.filter((s) => s === null).length;

  return (
    <View>
      <ThemedText type="body">Add {payload.name} to your family</ThemedText>
      {payload.allergens.length === 0 ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          No allergies listed
        </ThemedText>
      ) : (
        payload.allergens.map((allergen, i) => {
          const label = allergenLabel(allergen);
          const question = `How severe is ${payload.name}'s ${label} allergy?`;
          return (
            <View
              key={allergen}
              style={styles.group}
              accessibilityRole="radiogroup"
              accessibilityLabel={question}
            >
              {/* The group's label is read on Android; iOS drops it, so the
                  visible line names the allergy there. */}
              <ThemedText
                type="caption"
                style={{ color: theme.textSecondary }}
                importantForAccessibility="no"
              >
                {label}
              </ThemedText>
              <View style={styles.chips}>
                {allergySeverities.map((severity) => (
                  <Chip
                    key={severity}
                    label={SEVERITY_LABEL[severity]}
                    // Up to nine groups of the same three words: each
                    // names its allergy, so a screen reader can tell them
                    // apart on both platforms.
                    accessibilityLabel={`${SEVERITY_LABEL[severity]}, ${label} allergy`}
                    variant="filter"
                    selected={severities[i] === severity}
                    accessibilityRole="radio"
                    onPress={() => {
                      const next = [...severities];
                      next[i] = severity;
                      onEdit({ ...edits, severities: next });
                    }}
                  />
                ))}
              </View>
            </View>
          );
        })
      )}
      {/* Why Save is not ready yet: with several allergies, which ones are
          still to pick is not obvious. */}
      {left > 0 ? (
        <ThemedText
          type="caption"
          style={[styles.left, { color: theme.textSecondary }]}
        >
          Choose a severity for each allergy ({left} left)
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: Spacing.sm, gap: Spacing.xs },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  left: { marginTop: Spacing.sm },
});
