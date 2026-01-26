import React, { useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding, Allergy } from "@/context/OnboardingContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";

const COMMON_ALLERGENS = [
  { id: "peanuts", name: "Peanuts", icon: "alert-circle" },
  { id: "tree_nuts", name: "Tree Nuts", icon: "alert-circle" },
  { id: "milk", name: "Dairy/Milk", icon: "droplet" },
  { id: "eggs", name: "Eggs", icon: "circle" },
  { id: "wheat", name: "Wheat/Gluten", icon: "layers" },
  { id: "soy", name: "Soy", icon: "square" },
  { id: "fish", name: "Fish", icon: "anchor" },
  { id: "shellfish", name: "Shellfish", icon: "anchor" },
  { id: "sesame", name: "Sesame", icon: "circle" },
] as const;

const SEVERITY_OPTIONS = [
  { value: "mild", label: "Mild", description: "Slight discomfort" },
  { value: "moderate", label: "Moderate", description: "Noticeable reaction" },
  { value: "severe", label: "Severe", description: "Life-threatening" },
] as const;

export default function AllergiesScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, updateData, nextStep, prevStep } = useOnboarding();
  const [selectedAllergen, setSelectedAllergen] = useState<string | null>(null);

  const toggleAllergen = (allergenId: string) => {
    const existing = data.allergies.find((a) => a.name === allergenId);
    if (existing) {
      updateData({
        allergies: data.allergies.filter((a) => a.name !== allergenId),
      });
    } else {
      setSelectedAllergen(allergenId);
    }
  };

  const setSeverity = (severity: "mild" | "moderate" | "severe") => {
    if (selectedAllergen) {
      const filtered = data.allergies.filter((a) => a.name !== selectedAllergen);
      updateData({
        allergies: [...filtered, { name: selectedAllergen, severity }],
      });
      setSelectedAllergen(null);
    }
  };

  const getAllergenSeverity = (allergenId: string) => {
    return data.allergies.find((a) => a.name === allergenId)?.severity;
  };

  const isAllergenSelected = (allergenId: string) => {
    return data.allergies.some((a) => a.name === allergenId);
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
          <View style={[styles.stepIndicator, { backgroundColor: Colors.light.success + "15" }]}>
            <ThemedText type="small" style={{ color: Colors.light.success, fontWeight: "600" }}>
              Step 1 of 6
            </ThemedText>
          </View>
          <ThemedText type="h3" style={styles.title}>
            Any Food Allergies?
          </ThemedText>
          <ThemedText type="body" style={[styles.subtitle, { color: theme.textSecondary }]}>
            Select any allergens and we'll help you avoid them. This is important for your safety.
          </ThemedText>
        </View>

        <View style={styles.allergensGrid}>
          {COMMON_ALLERGENS.map((allergen) => {
            const selected = isAllergenSelected(allergen.id);
            const severity = getAllergenSeverity(allergen.id);
            return (
              <Pressable
                key={allergen.id}
                onPress={() => toggleAllergen(allergen.id)}
                style={[
                  styles.allergenItem,
                  {
                    backgroundColor: selected ? Colors.light.success + "15" : theme.backgroundDefault,
                    borderColor: selected ? Colors.light.success : theme.border,
                  },
                ]}
              >
                <ThemedText type="body" style={{ fontWeight: selected ? "600" : "400" }}>
                  {allergen.name}
                </ThemedText>
                {severity ? (
                  <View
                    style={[
                      styles.severityBadge,
                      {
                        backgroundColor:
                          severity === "severe"
                            ? Colors.light.error
                            : severity === "moderate"
                            ? Colors.light.warning
                            : Colors.light.success,
                      },
                    ]}
                  >
                    <ThemedText type="caption" style={{ color: "#FFF", fontWeight: "600" }}>
                      {severity.charAt(0).toUpperCase() + severity.slice(1)}
                    </ThemedText>
                  </View>
                ) : selected ? (
                  <Feather name="check" size={18} color={Colors.light.success} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {selectedAllergen ? (
          <View style={[styles.severityModal, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="body" style={{ fontWeight: "600", marginBottom: Spacing.md }}>
              How severe is your {COMMON_ALLERGENS.find((a) => a.id === selectedAllergen)?.name} allergy?
            </ThemedText>
            <View style={styles.severityOptions}>
              {SEVERITY_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setSeverity(option.value)}
                  style={[
                    styles.severityOption,
                    {
                      backgroundColor:
                        option.value === "severe"
                          ? Colors.light.error + "15"
                          : option.value === "moderate"
                          ? Colors.light.warning + "15"
                          : Colors.light.success + "15",
                      borderColor:
                        option.value === "severe"
                          ? Colors.light.error
                          : option.value === "moderate"
                          ? Colors.light.warning
                          : Colors.light.success,
                    },
                  ]}
                >
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {option.label}
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {option.description}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.footerButtons}>
          <Pressable onPress={prevStep} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color={theme.text} />
          </Pressable>
          <Button onPress={nextStep} style={styles.continueButton}>
            {data.allergies.length > 0 ? "Continue" : "No Allergies"}
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
  allergensGrid: {
    gap: Spacing.md,
  },
  allergenItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  severityBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  severityModal: {
    marginTop: Spacing.xl,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  severityOptions: {
    gap: Spacing.sm,
  },
  severityOption: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
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
