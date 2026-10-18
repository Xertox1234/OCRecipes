import React from "react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { AttributeChip } from "@/components/AttributeChip";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, MAX_FONT_SCALE_CONSTRAINED } from "@/constants/theme";
import { toRecipeAllergenLabels } from "./recipe-allergen-label-utils";
import { ALLERGEN_ICON, CONTAINS_COLOR_KEY } from "./recipe-attribute-visuals";
import type { DerivedRecipeAllergen } from "@shared/constants/allergens";

interface RecipeAllergenLabelProps {
  /**
   * The recipe's own derived allergen cache — deliberately NOT filtered by
   * the viewer's declared allergies. `null`/`undefined`/`[]` all render
   * nothing (see `toRecipeAllergenLabels`'s fail-dangerous contract); there
   * is no "no allergens"/"allergen-free"/safe branch here.
   */
  allergens: DerivedRecipeAllergen[] | null | undefined;
}

/**
 * Universal, profile-independent "Contains: <allergens>" label. Draws one
 * icon + word `AttributeChip` per allergen (recipe attribute icons, spec
 * 2026-10-17) — no new allergen engine, no re-derivation.
 *
 * Distinct from `AllergenWarningBanner` (which escalates only for allergens
 * the *viewer* has declared): this label is the calm, always-shown baseline
 * driven purely by the recipe's own data.
 */
export const RecipeAllergenLabel = React.memo(function RecipeAllergenLabel({
  allergens,
}: RecipeAllergenLabelProps) {
  const { theme } = useTheme();
  const labels = toRecipeAllergenLabels(allergens);

  if (labels.length === 0) return null;

  const composedLabel = `Contains: ${labels.map((l) => l.label).join(", ")}`;

  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="text"
      accessibilityLabel={composedLabel}
    >
      {/* Decorative — the parent View above carries the single composed
          a11y label; hide the visible lead-in + chips from the a11y tree so
          VoiceOver/TalkBack doesn't drill into the chips' own Text
          descendants and double-announce. */}
      <View
        style={styles.row}
        accessible={false}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        <ThemedText
          type="caption"
          maxScale={MAX_FONT_SCALE_CONSTRAINED}
          style={{ color: theme.text, fontWeight: "600" }}
        >
          Contains:
        </ThemedText>
        {labels.map(({ id, label }) => (
          <AttributeChip
            key={id}
            icon={ALLERGEN_ICON[id]}
            colorKey={CONTAINS_COLOR_KEY}
            word={label}
          />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.xs,
  },
});
