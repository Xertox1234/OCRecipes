import React from "react";
import { StyleSheet, View } from "react-native";

import {
  getRecipeAttributes,
  RECIPE_ATTRIBUTE_LABELS,
  type RecipeAttributeFacts,
} from "@shared/constants/recipe-attributes";
import { Spacing } from "@/constants/theme";
import { AttributeChip } from "./AttributeChip";
import { RecipeAllergenLabel } from "./RecipeAllergenLabel";
import { RECIPE_ATTRIBUTE_VISUALS } from "./recipe-attribute-visuals";
import { toRecipeAttributeSpokenList } from "./recipe-attribute-row-utils";

interface RecipeAttributeRowProps {
  facts: RecipeAttributeFacts;
}

/**
 * Checked diet + quick chips, then the separate "Contains:" group — a "free
 * of" chip never mixes with a "contains" chip. Inside an accessible card the
 * card's own label (`toRecipeAttributeA11ySuffix`) is what screen readers
 * hear.
 */
export const RecipeAttributeRow = React.memo(function RecipeAttributeRow({
  facts,
}: RecipeAttributeRowProps) {
  const ids = getRecipeAttributes(facts);
  const spoken = toRecipeAttributeSpokenList(facts);
  return (
    <>
      {ids.length > 0 && (
        <View
          style={styles.container}
          accessible
          accessibilityRole="text"
          accessibilityLabel={spoken}
        >
          {/* Decorative — the View above carries the spoken list. */}
          <View
            style={styles.row}
            accessible={false}
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
          >
            {ids.map((id) => (
              <AttributeChip
                key={id}
                icon={RECIPE_ATTRIBUTE_VISUALS[id].icon}
                colorKey={RECIPE_ATTRIBUTE_VISUALS[id].colorKey}
                word={RECIPE_ATTRIBUTE_LABELS[id].word}
              />
            ))}
          </View>
        </View>
      )}
      <RecipeAllergenLabel allergens={facts.allergens} />
    </>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.xs,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.xs,
  },
});
