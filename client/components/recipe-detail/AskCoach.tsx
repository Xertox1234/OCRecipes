import React, { useMemo, useState } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/types/navigation";

export interface CoachSuggestion {
  text: string;
  question: string;
}

export function generateCoachSuggestions(recipe: {
  title: string;
  dietTags?: string[];
  ingredientNames?: string[];
}): CoachSuggestion[] {
  const suggestions: CoachSuggestion[] = [];

  // Diet-tag based suggestions
  if (recipe.dietTags?.includes("high-protein")) {
    suggestions.push({
      text: "Ask about complementary side dishes for this high-protein recipe",
      question: `I'm looking at the recipe "${recipe.title}". Can you suggest complementary side dishes that pair well with this high-protein meal?`,
    });
  }

  if (
    recipe.dietTags?.includes("vegetarian") ||
    recipe.dietTags?.includes("vegan")
  ) {
    suggestions.push({
      text: "Ask about boosting the protein in this plant-based recipe",
      question: `I'm looking at the recipe "${recipe.title}". How can I boost the protein content while keeping it plant-based?`,
    });
  }

  // Fallback — always have at least one suggestion
  if (suggestions.length === 0) {
    suggestions.push({
      text: "Ask the coach about wine pairings, cooking tips, or ingredient substitutions",
      question: `I'm looking at the recipe "${recipe.title}". Can you suggest wine pairings, cooking tips, or ingredient substitutions?`,
    });
  }

  return suggestions.slice(0, 2);
}

interface AskCoachProps {
  recipeId: number;
  recipeType: "mealPlan" | "community";
  title: string;
  dietTags?: string[];
  ingredientNames?: string[];
}

export function AskCoach({
  recipeId,
  recipeType,
  title,
  dietTags,
  ingredientNames,
}: AskCoachProps) {
  const { theme } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [isLoading, setIsLoading] = useState(false);

  const suggestions = useMemo(
    () => generateCoachSuggestions({ title, dietTags, ingredientNames }),
    [title, dietTags, ingredientNames],
  );

  const primarySuggestion = suggestions[0];
  if (!primarySuggestion) return null;

  const handlePress = () => {
    if (isLoading) return;
    setIsLoading(true);

    navigation.navigate("RecipeCoachChat", {
      recipeId,
      recipeType,
      initialQuestion: primarySuggestion.question,
    });

    // Reset loading after navigation animation
    setTimeout(() => setIsLoading(false), 1000);
  };

  return (
    <View style={styles.section}>
      <ThemedText
        type="h4"
        style={styles.sectionTitle}
        accessibilityRole="header"
      >
        Ask Coach
      </ThemedText>
      <ThemedText
        style={[styles.suggestionText, { color: theme.textSecondary }]}
      >
        {primarySuggestion.text}
      </ThemedText>
      <Pressable
        onPress={handlePress}
        disabled={isLoading}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.link },
          pressed && { opacity: 0.85 },
          isLoading && { opacity: 0.6 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Ask Coach Now: ${primarySuggestion.text}`}
        accessibilityHint="Opens a coach chat modal about this recipe. Dismiss to return to recipe."
      >
        <Feather
          name="message-circle"
          size={18}
          color="#FFFFFF" // hardcoded
          accessible={false}
        />
        <ThemedText style={styles.buttonText}>Ask Coach Now</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
  },
  suggestionText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.button,
    gap: Spacing.sm,
  },
  buttonText: {
    color: "#FFFFFF", // hardcoded
    fontSize: 16,
    fontWeight: "600",
  },
});
