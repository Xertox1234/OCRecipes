import React from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding } from "@/context/OnboardingContext";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

const DIET_TYPES = [
  {
    id: "omnivore",
    name: "Omnivore",
    description: "I eat everything",
    icon: "globe",
  },
  {
    id: "vegetarian",
    name: "Vegetarian",
    description: "No meat or fish",
    icon: "feather",
  },
  {
    id: "vegan",
    name: "Vegan",
    description: "No animal products",
    icon: "sun",
  },
  {
    id: "pescatarian",
    name: "Pescatarian",
    description: "Vegetarian + fish",
    icon: "anchor",
  },
  {
    id: "keto",
    name: "Keto",
    description: "Very low carb, high fat",
    icon: "zap",
  },
  {
    id: "paleo",
    name: "Paleo",
    description: "Whole foods, no grains",
    icon: "leaf",
  },
  {
    id: "mediterranean",
    name: "Mediterranean",
    description: "Plant-based, healthy fats",
    icon: "droplet",
  },
  {
    id: "halal",
    name: "Halal",
    description: "Islamic dietary laws",
    icon: "moon",
  },
  {
    id: "kosher",
    name: "Kosher",
    description: "Jewish dietary laws",
    icon: "star",
  },
  {
    id: "low_fodmap",
    name: "Low FODMAP",
    description: "For digestive health",
    icon: "activity",
  },
];

export default function DietTypeScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, updateData, nextStep, prevStep } = useOnboarding();

  const selectDietType = (dietId: string) => {
    updateData({ dietType: data.dietType === dietId ? null : dietId });
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
              Step 3 of 6
            </ThemedText>
          </View>
          <ThemedText type="h3" style={styles.title}>
            What&apos;s Your Diet?
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            Choose your primary eating style. We&apos;ll use this to suggest
            compatible recipes.
          </ThemedText>
        </View>

        <View style={styles.dietsGrid}>
          {DIET_TYPES.map((diet) => {
            const selected = data.dietType === diet.id;
            return (
              <Pressable
                key={diet.id}
                onPress={() => selectDietType(diet.id)}
                accessibilityLabel={`${diet.name}: ${diet.description}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.dietItem,
                  {
                    backgroundColor: selected
                      ? withOpacity(theme.success, 0.08)
                      : theme.backgroundDefault,
                    borderColor: selected ? theme.success : theme.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.dietIcon,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.success, 0.12)
                        : theme.backgroundSecondary,
                    },
                  ]}
                >
                  <Feather
                    name={diet.icon as keyof typeof Feather.glyphMap}
                    size={24}
                    color={selected ? theme.success : theme.textSecondary}
                  />
                </View>
                <ThemedText
                  type="body"
                  style={{
                    fontWeight: selected ? "600" : "400",
                    textAlign: "center",
                  }}
                >
                  {diet.name}
                </ThemedText>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary, textAlign: "center" }}
                >
                  {diet.description}
                </ThemedText>
                {selected ? (
                  <View
                    style={[
                      styles.selectedBadge,
                      { backgroundColor: theme.success },
                    ]}
                  >
                    <Feather name="check" size={14} color={theme.buttonText} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
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
            {data.dietType ? "Continue" : "Skip"}
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
  dietsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  dietItem: {
    width: "47%",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    gap: Spacing.sm,
    position: "relative",
  },
  dietIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  selectedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
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
