import React, { useEffect, useMemo } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { AllergenBadge } from "@/components/AllergenBadge";
import { AllergenWarningBanner } from "@/components/AllergenWarningBanner";
import { InlineSubstitution } from "@/components/InlineSubstitution";
import { IngredientIcon } from "@/components/IngredientIcon";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  FontFamily,
  BorderRadius,
  withOpacity,
} from "@/constants/theme";
import {
  ALLERGEN_INGREDIENT_MAP,
  type AllergySeverity,
} from "@shared/constants/allergens";
import type { AllergenCheckResult } from "@shared/types/allergen-check";

const ALLERGEN_CHECK_FAILED_MESSAGE =
  "Unable to check this recipe against your allergies. Tap to retry.";

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
  /**
   * True when the allergen-check query failed. A declared-allergy user must not
   * see "no warning" when the check merely errored, so we render a cautionary
   * banner instead of silently dropping the allergen UI.
   */
  allergenCheckFailed?: boolean;
  /** Retry the failed allergen check. */
  onRetryAllergenCheck?: () => void;
}

export function RecipeIngredientsList({
  ingredients,
  allergenResult,
  allergenCheckFailed,
  onRetryAllergenCheck,
}: RecipeIngredientsListProps) {
  const { theme } = useTheme();

  // A failed allergen check is a safety-relevant error: announce it so a
  // screen-reader user is told the check didn't run. Android uses the banner's
  // assertive live region; iOS uses announceForAccessibility (gated to avoid a
  // double announcement against the live region).
  useEffect(() => {
    if (allergenCheckFailed && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(ALLERGEN_CHECK_FAILED_MESSAGE);
    }
  }, [allergenCheckFailed]);

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

      {allergenCheckFailed && (
        <Pressable
          onPress={onRetryAllergenCheck}
          accessibilityRole="button"
          accessibilityLabel="Unable to check this recipe against your allergies"
          accessibilityHint="Retries the allergen check"
          accessibilityLiveRegion="assertive"
          style={[
            styles.allergenErrorBanner,
            {
              backgroundColor: withOpacity(theme.warning, 0.08),
              borderLeftColor: theme.warning,
            },
          ]}
        >
          <Feather
            name="alert-triangle"
            size={18}
            color={theme.warning}
            accessible={false}
          />
          <ThemedText
            type="small"
            style={{
              color: theme.warning,
              marginLeft: Spacing.sm,
              flex: 1,
              fontWeight: "600",
            }}
          >
            {ALLERGEN_CHECK_FAILED_MESSAGE}
          </ThemedText>
        </Pressable>
      )}

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
  allergenErrorBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderLeftWidth: 3,
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
