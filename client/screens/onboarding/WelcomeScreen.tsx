import React from "react";
import { View, StyleSheet, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding } from "@/context/OnboardingContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";

export default function WelcomeScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { nextStep, skipOnboarding, isSubmitting } = useOnboarding();

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[styles.content, { paddingTop: insets.top + Spacing["3xl"] }]}
      >
        <View style={styles.iconContainer}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: Colors.light.success + "15" },
            ]}
          >
            <Feather name="heart" size={48} color={Colors.light.success} />
          </View>
        </View>

        <ThemedText type="h2" style={styles.title}>
          Let's Personalize Your Experience
        </ThemedText>

        <ThemedText
          type="body"
          style={[styles.subtitle, { color: theme.textSecondary }]}
        >
          Answer a few quick questions so we can give you personalized nutrition
          advice, filter recipes for your dietary needs, and help you reach your
          health goals.
        </ThemedText>

        <View style={styles.features}>
          <FeatureItem
            icon="shield"
            title="Allergy Safety"
            description="We'll flag foods that don't fit your dietary needs"
            theme={theme}
          />
          <FeatureItem
            icon="target"
            title="Goal-Focused"
            description="Get recommendations tailored to your health goals"
            theme={theme}
          />
          <FeatureItem
            icon="book-open"
            title="Smart Recipes"
            description="AI-powered recipe suggestions based on your preferences"
            theme={theme}
          />
        </View>
      </View>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}
      >
        <Button onPress={nextStep} style={styles.button}>
          Get Started
        </Button>
        <Button
          onPress={skipOnboarding}
          disabled={isSubmitting}
          style={[styles.skipButton, { backgroundColor: "transparent" }]}
        >
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Skip for now
          </ThemedText>
        </Button>
      </View>
    </View>
  );
}

function FeatureItem({
  icon,
  title,
  description,
  theme,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  return (
    <View style={styles.featureItem}>
      <View
        style={[
          styles.featureIcon,
          { backgroundColor: Colors.light.success + "15" },
        ]}
      >
        <Feather name={icon} size={20} color={Colors.light.success} />
      </View>
      <View style={styles.featureText}>
        <ThemedText type="body" style={{ fontWeight: "600" }}>
          {title}
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {description}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: Spacing["3xl"],
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  subtitle: {
    textAlign: "center",
    marginBottom: Spacing["3xl"],
  },
  features: {
    gap: Spacing.lg,
  },
  featureItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    flex: 1,
    gap: 2,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  button: {
    width: "100%",
  },
  skipButton: {
    width: "100%",
  },
});
