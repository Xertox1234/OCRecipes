import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { AllergenBadge } from "@/components/AllergenBadge";
import { AllergenWarningBanner } from "@/components/AllergenWarningBanner";
import { InlineSubstitution } from "@/components/InlineSubstitution";
import { IngredientIcon } from "@/components/IngredientIcon";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily } from "@/constants/theme";
import {
  ALLERGEN_INGREDIENT_MAP,
  type AllergySeverity,
} from "@shared/constants/allergens";
import type { AllergenCheckResult } from "@shared/types/allergen-check";

export interface IngredientItem {
  id?: number;
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
  annotation?: string;
}

interface RecipeIngredientsListProps {
  ingredients: IngredientItem[];
  allergenResult?: AllergenCheckResult | null;
}

export function RecipeIngredientsList({
  ingredients,
  allergenResult,
}: RecipeIngredientsListProps) {
  const { theme } = useTheme();

  // Build a lookup: ingredient name → allergen match (for per-row badges)
  const allergenMatchMap = useMemo(() => {
    const map = new Map<
      string,
      { allergenId: string; severity: AllergySeverity; label: string }
    >();
    if (!allergenResult?.matches) return map;
    for (const m of allergenResult.matches) {
      if (!map.has(m.ingredientName)) {
        const def = ALLERGEN_INGREDIENT_MAP[m.allergenId];
        map.set(m.ingredientName, {
          allergenId: m.allergenId,
          severity: m.severity,
          label: def?.label ?? m.allergenId,
        });
      }
    }
    return map;
  }, [allergenResult?.matches]);

  // Build a lookup: ingredient name → substitution suggestions
  const substitutionsByName = useMemo(() => {
    type SubArray = NonNullable<typeof allergenResult>["substitutions"];
    const map = new Map<string, SubArray>();
    if (!allergenResult?.substitutions || !allergenResult?.matches) return map;

    const uniqueNames: string[] = [];
    const seen = new Set<string>();
    for (const m of allergenResult.matches) {
      if (!seen.has(m.ingredientName)) {
        seen.add(m.ingredientName);
        uniqueNames.push(m.ingredientName);
      }
    }

    for (const s of allergenResult.substitutions) {
      const idxStr = s.originalIngredientId.replace("allergen-check-", "");
      const idx = parseInt(idxStr, 10);
      const name = !isNaN(idx) ? uniqueNames[idx] : undefined;
      if (!name) continue;

      const existing = map.get(name) ?? [];
      existing.push(s);
      map.set(name, existing);
    }
    return map;
  }, [allergenResult?.substitutions, allergenResult?.matches]);

  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>Ingredients</ThemedText>

      {allergenResult?.matches && allergenResult.matches.length > 0 && (
        <View style={{ marginBottom: Spacing.md }}>
          <AllergenWarningBanner matches={allergenResult.matches} />
        </View>
      )}

      {ingredients.map((ing, idx) => {
        const match = allergenMatchMap.get(ing.name);
        const borderColor = match
          ? match.severity === "severe"
            ? theme.error
            : match.severity === "moderate"
              ? theme.warning
              : theme.info
          : undefined;

        return (
          <View
            key={ing.id || idx}
            style={[
              styles.ingredientRow,
              borderColor && {
                borderLeftWidth: 3,
                borderLeftColor: borderColor,
                paddingLeft: Spacing.sm,
              },
            ]}
          >
            <IngredientIcon name={ing.name} size={22} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.ingredientText}>
                {ing.quantity && ing.unit
                  ? `${ing.quantity} ${ing.unit} `
                  : ing.quantity
                    ? `${ing.quantity} `
                    : ""}
                {ing.name}
              </ThemedText>
              {match && (
                <View style={{ marginTop: 2 }}>
                  <AllergenBadge
                    allergenLabel={match.label}
                    severity={match.severity}
                  />
                </View>
              )}
              {substitutionsByName.get(ing.name)?.map((sub, si) => (
                <InlineSubstitution
                  key={`${ing.name}-sub-${si}`}
                  substitute={sub.substitute}
                  reason={sub.reason}
                  ratio={sub.ratio}
                  macroDelta={sub.macroDelta}
                  confidence={sub.confidence}
                />
              ))}
              {ing.annotation && (
                <ThemedText
                  style={[
                    styles.annotationText,
                    { color: theme.textSecondary },
                  ]}
                >
                  {ing.annotation}
                </ThemedText>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.md,
  },
  ingredientRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  ingredientText: {
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  annotationText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    fontStyle: "italic",
    marginTop: 2,
  },
});
