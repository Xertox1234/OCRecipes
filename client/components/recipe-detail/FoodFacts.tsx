import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import foodFactsData from "@/data/food-facts.json";

interface FoodFact {
  ingredient: string;
  text: string;
}

// Pre-lowercase keys at module load time to avoid repeated toLowerCase() calls
const factEntries = Object.entries(
  foodFactsData as Record<string, string[]>,
).map(([key, facts]) => ({ key: key.toLowerCase(), facts }));

export function getFactsForIngredients(
  ingredientNames: string[],
  maxFacts = 3,
): FoodFact[] {
  const seen = new Set<string>();
  const results: FoodFact[] = [];

  for (const name of ingredientNames) {
    if (results.length >= maxFacts) break;
    const lower = name.toLowerCase();

    for (const { key, facts } of factEntries) {
      if (results.length >= maxFacts) break;
      if (!lower.includes(key)) continue;

      for (const text of facts) {
        if (results.length >= maxFacts) break;
        if (seen.has(text)) continue;
        seen.add(text);
        results.push({ ingredient: key, text });
      }
    }
  }

  return results;
}

export function FoodFacts({ ingredientNames }: { ingredientNames: string[] }) {
  const { theme } = useTheme();

  const facts = useMemo(
    () => getFactsForIngredients(ingredientNames),
    [ingredientNames],
  );

  if (facts.length === 0) return null;

  return (
    <View
      style={styles.section}
      role="group"
      accessibilityLabel={`Interesting food facts, ${facts.length} ${facts.length === 1 ? "fact" : "facts"}`}
    >
      <ThemedText
        type="h4"
        style={styles.sectionTitle}
        accessibilityRole="header"
      >
        Food Facts
      </ThemedText>
      {facts.map((fact, i) => (
        <View
          key={i}
          style={[
            styles.factCard,
            { backgroundColor: withOpacity(theme.text, 0.04) },
          ]}
          accessible
          accessibilityLabel={`Food fact: ${fact.text}`}
        >
          <Feather
            name="zap"
            size={16}
            color={theme.warning}
            style={styles.factIcon}
            accessible={false}
          />
          <ThemedText style={styles.factText}>{fact.text}</ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  factCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.sm,
  },
  factIcon: {
    marginRight: Spacing.sm,
    marginTop: 2,
  },
  factText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
