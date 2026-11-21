import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding } from "@/context/OnboardingContext";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";

// Only what family planning does today. Add a point when a new family
// feature ships, never before (the card must not promise ahead of the app).
const POINTS = [
  {
    icon: "calendar" as const,
    title: "One plan for everyone",
    description: "Shared meals, or a meal just for one.",
  },
  {
    icon: "shield" as const,
    title: "Allergy checks for each person",
    description: "See who a recipe clashes with.",
  },
  {
    icon: "shopping-cart" as const,
    title: "Grocery lists for every plate",
    description: "Quantities that cover everyone.",
  },
];

/**
 * The family-planning card in onboarding (owner ruling 2026-11-21). It
 * promotes a premium feature and says where to turn it on. It asks nothing
 * and saves nothing: Continue only moves to the next step.
 */
export default function FamilyIntroScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { nextStep, prevStep } = useOnboarding();

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
      >
        <View style={styles.iconContainer}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: withOpacity(theme.link, 0.08) },
            ]}
          >
            <Feather
              name="users"
              size={48}
              color={theme.link}
              accessible={false}
            />
          </View>
        </View>

        <View
          style={[
            styles.premiumPill,
            { backgroundColor: withOpacity(theme.link, 0.08) },
          ]}
        >
          <Feather
            name="star"
            size={14}
            color={theme.link}
            accessible={false}
          />
          <ThemedText
            type="small"
            style={{ color: theme.link, fontWeight: "600" }}
          >
            Premium
          </ThemedText>
        </View>

        <ThemedText type="h2" style={styles.title}>
          Cooking for more than one?
        </ThemedText>

        <ThemedText
          type="body"
          style={[styles.subtitle, { color: theme.textSecondary }]}
        >
          Plan the week for your whole table.
        </ThemedText>

        <View accessibilityRole="list" style={styles.points}>
          {POINTS.map((point) => (
            <View key={point.title} style={styles.point}>
              <View
                style={[
                  styles.pointIcon,
                  { backgroundColor: withOpacity(theme.link, 0.08) },
                ]}
              >
                <Feather
                  name={point.icon}
                  size={20}
                  color={theme.link}
                  accessible={false}
                />
              </View>
              <View style={styles.pointText}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {point.title}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {point.description}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.howBox,
            {
              backgroundColor: withOpacity(theme.link, 0.08),
              borderColor: withOpacity(theme.link, 0.2),
            },
          ]}
        >
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            Family planning is part of Premium
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
          >
            Turn it on any time in Profile → Plan for my family.
          </ThemedText>
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}
      >
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
        <Button
          onPress={nextStep}
          style={styles.continueButton}
          accessibilityLabel="Continue"
          testID="family-intro-continue"
        >
          Continue
        </Button>
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
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  premiumPill: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    marginBottom: Spacing.lg,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  subtitle: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  points: {
    gap: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  point: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  pointIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pointText: {
    flex: 1,
    gap: 2,
  },
  howBox: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
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
