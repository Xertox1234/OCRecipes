import React, { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { SelectableTile } from "@/components/SelectableTile";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import {
  COMMON_ALLERGENS,
  SEVERITY_OPTIONS,
} from "@/constants/dietary-options";
import type { Allergy } from "@shared/schema";

type Severity = Allergy["severity"];

interface AllergenGridProps {
  allergies: Allergy[];
  /** The allergen waiting for its severity, or null. */
  pendingAllergen: string | null;
  onToggle: (allergenId: string) => void;
  onSeverity: (severity: Severity) => void;
  disabled?: boolean;
}

/**
 * The allergen chips and the severity choice, driven entirely by its props.
 * The dietary-profile form feeds it from `useDietaryProfileForm` (which also
 * opens the choice for the Coach's add-allergen hand-off); `AllergenPicker`
 * below feeds it from local state. The chips tick `selection()` themselves
 * (SelectableTile), so nothing here buzzes.
 */
export function AllergenGrid({
  allergies,
  pendingAllergen,
  onToggle,
  onSeverity,
  disabled,
}: AllergenGridProps) {
  const { theme } = useTheme();

  const severityColor = (severity: Severity | undefined) =>
    severity === "severe"
      ? theme.error
      : severity === "moderate"
        ? theme.warning
        : theme.success;

  return (
    <View>
      <View style={styles.optionsGrid}>
        {COMMON_ALLERGENS.map((allergen) => {
          const allergy = allergies.find((a) => a.name === allergen.id);
          const selected = !!allergy;
          return (
            <SelectableTile
              shape="chip"
              key={allergen.id}
              onPress={() => onToggle(allergen.id)}
              disabled={disabled}
              accessibilityLabel={allergen.name}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled: !!disabled }}
              style={[
                styles.optionChip,
                {
                  backgroundColor: selected
                    ? withOpacity(severityColor(allergy?.severity), 0.12)
                    : theme.backgroundDefault,
                  borderColor: selected
                    ? severityColor(allergy?.severity)
                    : theme.border,
                },
              ]}
            >
              <ThemedText
                type="small"
                style={{ fontWeight: selected ? "600" : "400" }}
              >
                {allergen.name}
              </ThemedText>
              {allergy && (
                <View
                  style={[
                    styles.severityBadge,
                    { backgroundColor: severityColor(allergy.severity) },
                  ]}
                >
                  <ThemedText
                    type="caption"
                    style={{ color: theme.buttonText, fontSize: 10 }}
                  >
                    {allergy.severity.charAt(0).toUpperCase()}
                  </ThemedText>
                </View>
              )}
            </SelectableTile>
          );
        })}
      </View>

      {pendingAllergen && (
        <View
          style={[
            styles.severityModal,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            Severity for{" "}
            {COMMON_ALLERGENS.find((a) => a.id === pendingAllergen)?.name}?
          </ThemedText>
          <View style={styles.severityOptions}>
            {SEVERITY_OPTIONS.map((option) => (
              <SelectableTile
                key={option.value}
                onPress={() => onSeverity(option.value)}
                disabled={disabled}
                accessibilityLabel={`${option.label}: ${option.description}`}
                accessibilityRole="button"
                style={[
                  styles.severityOption,
                  {
                    backgroundColor: withOpacity(
                      severityColor(option.value),
                      0.08,
                    ),
                    borderColor: severityColor(option.value),
                  },
                ]}
              >
                <ThemedText type="small" style={{ fontWeight: "600" }}>
                  {option.label}
                </ThemedText>
              </SelectableTile>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

interface AllergenPickerProps {
  value: Allergy[];
  onChange: (next: Allergy[]) => void;
  disabled?: boolean;
}

/**
 * Allergy chips with a severity choice, for a form that keeps its own list
 * (the family-profile form). Tapping a chosen allergen removes it; tapping a
 * new one asks for the severity, and only then reports the new list.
 */
export function AllergenPicker({
  value,
  onChange,
  disabled,
}: AllergenPickerProps) {
  const [pending, setPending] = useState<string | null>(null);

  return (
    <AllergenGrid
      allergies={value}
      pendingAllergen={pending}
      disabled={disabled}
      onToggle={(allergenId) => {
        if (value.some((a) => a.name === allergenId)) {
          onChange(value.filter((a) => a.name !== allergenId));
          setPending(null);
        } else {
          setPending(allergenId);
        }
      }}
      onSeverity={(severity) => {
        if (!pending) return;
        onChange([
          ...value.filter((a) => a.name !== pending),
          { name: pending, severity },
        ]);
        setPending(null);
      }}
    />
  );
}

const styles = StyleSheet.create({
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  optionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  severityBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  severityModal: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  severityOptions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  severityOption: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
  },
});
