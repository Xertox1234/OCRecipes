import React from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding } from "@/context/OnboardingContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";

const HEALTH_CONDITIONS = [
  { id: "diabetes_type1", name: "Type 1 Diabetes", icon: "activity", description: "Need to monitor carbs and sugar" },
  { id: "diabetes_type2", name: "Type 2 Diabetes", icon: "activity", description: "Managing blood sugar levels" },
  { id: "heart_disease", name: "Heart Condition", icon: "heart", description: "Low sodium, heart-healthy diet" },
  { id: "high_blood_pressure", name: "High Blood Pressure", icon: "trending-up", description: "Limiting salt intake" },
  { id: "high_cholesterol", name: "High Cholesterol", icon: "bar-chart-2", description: "Watching fats and cholesterol" },
  { id: "ibs", name: "IBS", icon: "zap", description: "Avoiding trigger foods" },
  { id: "celiac", name: "Celiac Disease", icon: "slash", description: "Strict gluten-free required" },
  { id: "kidney_disease", name: "Kidney Condition", icon: "filter", description: "Managing protein and minerals" },
  { id: "pcos", name: "PCOS", icon: "circle", description: "Hormone-balancing nutrition" },
  { id: "gerd", name: "GERD/Acid Reflux", icon: "droplet", description: "Avoiding acidic foods" },
];

export default function HealthConditionsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, updateData, nextStep, prevStep } = useOnboarding();

  const toggleCondition = (conditionId: string) => {
    const isSelected = data.healthConditions.includes(conditionId);
    if (isSelected) {
      updateData({
        healthConditions: data.healthConditions.filter((c) => c !== conditionId),
      });
    } else {
      updateData({
        healthConditions: [...data.healthConditions, conditionId],
      });
    }
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
              Step 2 of 6
            </ThemedText>
          </View>
          <ThemedText type="h3" style={styles.title}>
            Health Conditions
          </ThemedText>
          <ThemedText type="body" style={[styles.subtitle, { color: theme.textSecondary }]}>
            Select any conditions you manage. This helps us tailor nutrition advice to support your health.
          </ThemedText>
        </View>

        <View style={styles.conditionsGrid}>
          {HEALTH_CONDITIONS.map((condition) => {
            const selected = data.healthConditions.includes(condition.id);
            return (
              <Pressable
                key={condition.id}
                onPress={() => toggleCondition(condition.id)}
                style={[
                  styles.conditionItem,
                  {
                    backgroundColor: selected ? Colors.light.success + "15" : theme.backgroundDefault,
                    borderColor: selected ? Colors.light.success : theme.border,
                  },
                ]}
              >
                <View style={styles.conditionContent}>
                  <View style={[styles.conditionIcon, { backgroundColor: selected ? Colors.light.success + "20" : theme.backgroundSecondary }]}>
                    <Feather
                      name={condition.icon as keyof typeof Feather.glyphMap}
                      size={20}
                      color={selected ? Colors.light.success : theme.textSecondary}
                    />
                  </View>
                  <View style={styles.conditionText}>
                    <ThemedText type="body" style={{ fontWeight: selected ? "600" : "400" }}>
                      {condition.name}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      {condition.description}
                    </ThemedText>
                  </View>
                </View>
                {selected ? (
                  <Feather name="check-circle" size={22} color={Colors.light.success} />
                ) : (
                  <View style={[styles.checkbox, { borderColor: theme.border }]} />
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.footerButtons}>
          <Pressable onPress={prevStep} style={styles.backButton}>
            <Feather name="arrow-left" size={24} color={theme.text} />
          </Pressable>
          <Button onPress={nextStep} style={styles.continueButton}>
            {data.healthConditions.length > 0 ? "Continue" : "None of These"}
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
  conditionsGrid: {
    gap: Spacing.md,
  },
  conditionItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  conditionContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
  },
  conditionIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  conditionText: {
    flex: 1,
    gap: 2,
  },
  checkbox: {
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
