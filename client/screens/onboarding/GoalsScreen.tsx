import React from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding } from "@/context/OnboardingContext";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

const GOALS = [
  {
    id: "lose_weight",
    name: "Lose Weight",
    icon: "trending-down",
    color: "#FF6B35",
  },
  {
    id: "gain_muscle",
    name: "Build Muscle",
    icon: "trending-up",
    color: "#00C853",
  },
  { id: "maintain", name: "Maintain Weight", icon: "minus", color: "#2196F3" },
  {
    id: "eat_healthier",
    name: "Eat Healthier",
    icon: "heart",
    color: "#E91E63",
  },
  {
    id: "manage_condition",
    name: "Manage Condition",
    icon: "activity",
    color: "#9C27B0",
  },
];

const ACTIVITY_LEVELS = [
  { id: "sedentary", name: "Sedentary", description: "Little to no exercise" },
  {
    id: "light",
    name: "Lightly Active",
    description: "Light exercise 1-3 days/week",
  },
  {
    id: "moderate",
    name: "Moderately Active",
    description: "Moderate exercise 3-5 days/week",
  },
  {
    id: "active",
    name: "Very Active",
    description: "Hard exercise 6-7 days/week",
  },
  {
    id: "athlete",
    name: "Athlete",
    description: "Professional or intense training",
  },
];

export default function GoalsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, updateData, nextStep, prevStep } = useOnboarding();

  const selectGoal = (goalId: string) => {
    updateData({ primaryGoal: data.primaryGoal === goalId ? null : goalId });
  };

  const selectActivityLevel = (levelId: string) => {
    updateData({
      activityLevel: data.activityLevel === levelId ? null : levelId,
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
              { backgroundColor: withOpacity(theme.success, 0.08) },
            ]}
          >
            <ThemedText
              type="small"
              style={{ color: theme.success, fontWeight: "600" }}
            >
              Step 4 of 6
            </ThemedText>
          </View>
          <ThemedText type="h3" style={styles.title}>
            Your Goals
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            What are you hoping to achieve? This helps us personalize
            recommendations.
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="body" style={styles.sectionTitle}>
            Primary Goal
          </ThemedText>
          <View style={styles.goalsGrid} accessibilityRole="radiogroup">
            {GOALS.map((goal) => {
              const selected = data.primaryGoal === goal.id;
              return (
                <Pressable
                  key={goal.id}
                  onPress={() => selectGoal(goal.id)}
                  accessibilityLabel={goal.name}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.goalItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(goal.color, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? goal.color : theme.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.goalIcon,
                      { backgroundColor: withOpacity(goal.color, 0.12) },
                    ]}
                  >
                    <Feather
                      name={goal.icon as keyof typeof Feather.glyphMap}
                      size={24}
                      color={goal.color}
                    />
                  </View>
                  <ThemedText
                    type="small"
                    style={{
                      fontWeight: selected ? "600" : "400",
                      textAlign: "center",
                    }}
                  >
                    {goal.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="body" style={styles.sectionTitle}>
            Activity Level
          </ThemedText>
          <View style={styles.activityList} accessibilityRole="radiogroup">
            {ACTIVITY_LEVELS.map((level) => {
              const selected = data.activityLevel === level.id;
              return (
                <Pressable
                  key={level.id}
                  onPress={() => selectActivityLevel(level.id)}
                  accessibilityLabel={`${level.name}: ${level.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.activityItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.success, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.success : theme.border,
                    },
                  ]}
                >
                  <View style={styles.activityContent}>
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
                      color={theme.success}
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
          <Pressable
            onPress={prevStep}
            style={({ pressed }) => [
              styles.backButton,
              {
                backgroundColor: pressed
                  ? theme.backgroundTertiary
                  : theme.backgroundSecondary,
              },
            ]}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Feather name="arrow-left" size={24} color={theme.text} />
          </Pressable>
          <Button onPress={nextStep} style={styles.continueButton}>
            Continue
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
  goalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    justifyContent: "space-between",
  },
  goalItem: {
    flexBasis: "30%",
    flexGrow: 1,
    maxWidth: "32%",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
    gap: Spacing.sm,
  },
  goalIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  activityList: {
    gap: Spacing.sm,
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  activityContent: {
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
