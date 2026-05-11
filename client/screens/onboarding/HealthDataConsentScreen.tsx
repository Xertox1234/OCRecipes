import React from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding } from "@/context/OnboardingContext";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";

/**
 * Privacy Policy URL. Overridable at build time via `EXPO_PUBLIC_PRIVACY_POLICY_URL`
 * (Expo inlines `EXPO_PUBLIC_*` env vars at bundle time); falls back to the
 * production marketing-site URL.
 */
const PRIVACY_POLICY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? "https://ocrecipes.app/privacy";

const DATA_CATEGORIES = [
  {
    icon: "alert-circle" as const,
    title: "Allergies & severity",
    description:
      "So we can flag foods that are unsafe for you and warn you when scanning.",
  },
  {
    icon: "activity" as const,
    title: "Health conditions & medications",
    description:
      "Including any GLP-1 use, to tailor nutrition guidance and avoid contraindicated suggestions.",
  },
  {
    icon: "user" as const,
    title: "Body metrics & activity",
    description:
      "Age, height, weight, and activity level to estimate calorie and macro targets.",
  },
  {
    icon: "target" as const,
    title: "Dietary goals & preferences",
    description:
      "Your goals and food preferences to personalize meal plans and recipe ideas.",
  },
];

export default function HealthDataConsentScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { updateData, nextStep, prevStep } = useOnboarding();

  const handleAgree = () => {
    // Record the user's intent locally. The authoritative consent timestamp is
    // stamped server-side from `new Date()` when the profile is saved at the
    // end of onboarding — clients never supply or backdate `healthDataConsentAt`.
    updateData({ healthDataConsent: true });
    nextStep();
  };

  const handleSkip = () => {
    // Skip the consent gate but stay in onboarding. The intent flag stays
    // `false`; the server will not record `healthDataConsentAt`. Users can
    // still fill in (or skip) the health screens that follow and revisit
    // consent later from Profile.
    updateData({ healthDataConsent: false });
    nextStep();
  };

  const handleOpenPrivacy = () => {
    void Linking.openURL(PRIVACY_POLICY_URL);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingTop: Spacing["3xl"] }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: withOpacity(theme.success, 0.08) },
            ]}
          >
            <Feather name="shield" size={40} color={theme.success} />
          </View>
          <ThemedText type="h3" style={styles.title}>
            Your Health Data Stays Yours
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            Before we ask about allergies, conditions, and goals, here&apos;s
            what we collect and why.
          </ThemedText>
        </View>

        <View
          accessibilityRole="summary"
          accessibilityLabel="Categories of health data we collect"
          style={styles.categoriesList}
        >
          {DATA_CATEGORIES.map((category) => (
            <View
              key={category.title}
              style={[
                styles.categoryRow,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <View
                style={[
                  styles.categoryIcon,
                  { backgroundColor: withOpacity(theme.success, 0.08) },
                ]}
              >
                <Feather
                  name={category.icon}
                  size={20}
                  color={theme.success}
                  accessible={false}
                />
              </View>
              <View style={styles.categoryText}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {category.title}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {category.description}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>

        <View
          style={[
            styles.purposeBox,
            {
              backgroundColor: withOpacity(theme.success, 0.08),
              borderColor: withOpacity(theme.success, 0.2),
            },
          ]}
        >
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            Why we ask
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
          >
            To personalize nutrition recommendations and AI coaching. Your
            health data is never sold or shared with advertisers. You can update
            or delete it any time from your Profile.
          </ThemedText>
        </View>

        <Pressable
          onPress={handleOpenPrivacy}
          accessibilityRole="link"
          accessibilityLabel="Read our Privacy Policy"
          accessibilityHint="Opens the Privacy Policy in your browser"
          hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
          style={styles.privacyLink}
        >
          <Feather
            name="external-link"
            size={16}
            color={theme.link}
            accessible={false}
          />
          <ThemedText
            type="body"
            style={{
              color: theme.link,
              fontWeight: "600",
              marginLeft: Spacing.xs,
            }}
          >
            Read our Privacy Policy
          </ThemedText>
        </Pressable>
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
          <Button
            onPress={handleAgree}
            style={styles.agreeButton}
            accessibilityLabel="I agree to share my health data"
            accessibilityHint="Records your consent and continues onboarding"
          >
            I Agree
          </Button>
        </View>
        <Pressable
          onPress={handleSkip}
          accessibilityLabel="Not now, skip health data sharing"
          accessibilityHint="Continues onboarding without recording consent; you can fill in health details later from your Profile"
          accessibilityRole="button"
          style={styles.skipButton}
        >
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Not now
          </ThemedText>
        </Pressable>
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
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    textAlign: "center",
    lineHeight: 22,
  },
  categoriesList: {
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryText: {
    flex: 1,
    gap: 2,
  },
  purposeBox: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  privacyLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
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
  agreeButton: {
    flex: 1,
  },
  skipButton: {
    alignSelf: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
});
