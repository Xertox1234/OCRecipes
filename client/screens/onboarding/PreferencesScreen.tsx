import React from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding } from "@/context/OnboardingContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";

const CUISINES = [
  { id: "american", name: "American" },
  { id: "italian", name: "Italian" },
  { id: "mexican", name: "Mexican" },
  { id: "chinese", name: "Chinese" },
  { id: "japanese", name: "Japanese" },
  { id: "indian", name: "Indian" },
  { id: "thai", name: "Thai" },
  { id: "mediterranean", name: "Mediterranean" },
  { id: "korean", name: "Korean" },
  { id: "vietnamese", name: "Vietnamese" },
  { id: "french", name: "French" },
  { id: "greek", name: "Greek" },
];

const SKILL_LEVELS = [
  {
    id: "beginner",
    name: "Beginner",
    description: "Simple recipes, basic techniques",
  },
  {
    id: "intermediate",
    name: "Intermediate",
    description: "Comfortable with most recipes",
  },
  {
    id: "advanced",
    name: "Advanced",
    description: "Complex techniques welcome",
  },
];

const COOKING_TIMES = [
  { id: "quick", name: "Quick", description: "Under 30 minutes" },
  { id: "moderate", name: "Moderate", description: "30-60 minutes" },
  { id: "leisurely", name: "Leisurely", description: "1+ hours, no rush" },
];

export default function PreferencesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, updateData, prevStep, completeOnboarding, isSubmitting } =
    useOnboarding();

  const toggleCuisine = (cuisineId: string) => {
    const isSelected = data.cuisinePreferences.includes(cuisineId);
    if (isSelected) {
      updateData({
        cuisinePreferences: data.cuisinePreferences.filter(
          (c) => c !== cuisineId,
        ),
      });
    } else {
      updateData({
        cuisinePreferences: [...data.cuisinePreferences, cuisineId],
      });
    }
  };

  const selectSkillLevel = (levelId: string) => {
    updateData({
      cookingSkillLevel: data.cookingSkillLevel === levelId ? null : levelId,
    });
  };

  const selectCookingTime = (timeId: string) => {
    updateData({
      cookingTimeAvailable:
        data.cookingTimeAvailable === timeId ? null : timeId,
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing["3xl"] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View
            style={[
              styles.stepIndicator,
              { backgroundColor: Colors.light.success + "15" },
            ]}
          >
            <ThemedText
              type="small"
              style={{ color: Colors.light.success, fontWeight: "600" }}
            >
              Step 5 of 6
            </ThemedText>
          </View>
          <ThemedText type="h3" style={styles.title}>
            Cooking Preferences
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            Almost done! Tell us about your cooking style so we can suggest
            recipes you'll love.
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="body" style={styles.sectionTitle}>
            Favorite Cuisines
          </ThemedText>
          <View style={styles.cuisinesGrid}>
            {CUISINES.map((cuisine) => {
              const selected = data.cuisinePreferences.includes(cuisine.id);
              return (
                <Pressable
                  key={cuisine.id}
                  onPress={() => toggleCuisine(cuisine.id)}
                  style={[
                    styles.cuisineChip,
                    {
                      backgroundColor: selected
                        ? Colors.light.success
                        : theme.backgroundDefault,
                      borderColor: selected
                        ? Colors.light.success
                        : theme.border,
                    },
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color: selected ? "#FFF" : theme.text,
                      fontWeight: selected ? "600" : "400",
                    }}
                  >
                    {cuisine.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="body" style={styles.sectionTitle}>
            Cooking Skill Level
          </ThemedText>
          <View style={styles.optionsList}>
            {SKILL_LEVELS.map((level) => {
              const selected = data.cookingSkillLevel === level.id;
              return (
                <Pressable
                  key={level.id}
                  onPress={() => selectSkillLevel(level.id)}
                  style={[
                    styles.optionItem,
                    {
                      backgroundColor: selected
                        ? Colors.light.success + "15"
                        : theme.backgroundDefault,
                      borderColor: selected
                        ? Colors.light.success
                        : theme.border,
                    },
                  ]}
                >
                  <View style={styles.optionContent}>
                    <ThemedText
                      type="body"
                      style={{ fontWeight: selected ? "600" : "400" }}
                    >
                      {level.name}
                    </ThemedText>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      {level.description}
                    </ThemedText>
                  </View>
                  {selected ? (
                    <Feather
                      name="check-circle"
                      size={22}
                      color={Colors.light.success}
                    />
                  ) : (
                    <View
                      style={[styles.radio, { borderColor: theme.border }]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="body" style={styles.sectionTitle}>
            Time for Cooking
          </ThemedText>
          <View style={styles.optionsList}>
            {COOKING_TIMES.map((time) => {
              const selected = data.cookingTimeAvailable === time.id;
              return (
                <Pressable
                  key={time.id}
                  onPress={() => selectCookingTime(time.id)}
                  style={[
                    styles.optionItem,
                    {
                      backgroundColor: selected
                        ? Colors.light.success + "15"
                        : theme.backgroundDefault,
                      borderColor: selected
                        ? Colors.light.success
                        : theme.border,
                    },
                  ]}
                >
                  <View style={styles.optionContent}>
                    <ThemedText
                      type="body"
                      style={{ fontWeight: selected ? "600" : "400" }}
                    >
                      {time.name}
                    </ThemedText>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      {time.description}
                    </ThemedText>
                  </View>
                  {selected ? (
                    <Feather
                      name="check-circle"
                      size={22}
                      color={Colors.light.success}
                    />
                  ) : (
                    <View
                      style={[styles.radio, { borderColor: theme.border }]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}
      >
        <View style={styles.footerButtons}>
          <Pressable onPress={prevStep} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color={theme.text} />
          </Pressable>
          <Button
            onPress={completeOnboarding}
            disabled={isSubmitting}
            style={styles.continueButton}
          >
            {isSubmitting ? "Saving..." : "Complete Setup"}
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["3xl"],
  },
  header: {
    marginBottom: Spacing["2xl"],
  },
  stepIndicator: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    marginBottom: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.sm,
  },
  subtitle: {
    lineHeight: 22,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    fontWeight: "600",
    marginBottom: Spacing.md,
  },
  cuisinesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  cuisineChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  optionsList: {
    gap: Spacing.sm,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  optionContent: {
    flex: 1,
    gap: 2,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  footerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  backButton: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.full,
  },
  continueButton: {
    flex: 1,
  },
});
