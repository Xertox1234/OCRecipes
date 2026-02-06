import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { apiRequest } from "@/lib/query-client";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import {
  COMMON_ALLERGENS,
  SEVERITY_OPTIONS,
  DIET_TYPES,
  HEALTH_CONDITIONS,
  GOALS,
  ACTIVITY_LEVELS,
  CUISINES,
  SKILL_LEVELS,
  COOKING_TIMES,
} from "@/constants/dietary-options";

interface Allergy {
  name: string;
  severity: "mild" | "moderate" | "severe";
}

interface DietaryProfile {
  allergies?: Allergy[];
  healthConditions?: string[];
  dietType?: string | null;
  primaryGoal?: string | null;
  activityLevel?: string | null;
  cuisinePreferences?: string[];
  cookingSkillLevel?: string | null;
  cookingTimeAvailable?: string | null;
}

export default function EditDietaryProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const queryClient = useQueryClient();

  const [isSaving, setIsSaving] = useState(false);
  const [selectedAllergen, setSelectedAllergen] = useState<string | null>(null);

  // Form state
  const [allergies, setAllergies] = useState<Allergy[]>([]);
  const [healthConditions, setHealthConditions] = useState<string[]>([]);
  const [dietType, setDietType] = useState<string | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState<string | null>(null);
  const [activityLevel, setActivityLevel] = useState<string | null>(null);
  const [cuisinePreferences, setCuisinePreferences] = useState<string[]>([]);
  const [cookingSkillLevel, setCookingSkillLevel] = useState<string | null>(
    null,
  );
  const [cookingTimeAvailable, setCookingTimeAvailable] = useState<
    string | null
  >(null);

  const { data: profile, isLoading } = useQuery<DietaryProfile>({
    queryKey: ["/api/user/dietary-profile"],
  });

  // Initialize form state from fetched profile
  useEffect(() => {
    if (profile) {
      setAllergies(profile.allergies || []);
      setHealthConditions(profile.healthConditions || []);
      setDietType(profile.dietType || null);
      setPrimaryGoal(profile.primaryGoal || null);
      setActivityLevel(profile.activityLevel || null);
      setCuisinePreferences(profile.cuisinePreferences || []);
      setCookingSkillLevel(profile.cookingSkillLevel || null);
      setCookingTimeAvailable(profile.cookingTimeAvailable || null);
    }
  }, [profile]);

  const toggleAllergen = (allergenId: string) => {
    const existing = allergies.find((a) => a.name === allergenId);
    if (existing) {
      setAllergies(allergies.filter((a) => a.name !== allergenId));
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    } else {
      setSelectedAllergen(allergenId);
    }
  };

  const setSeverity = (severity: "mild" | "moderate" | "severe") => {
    if (selectedAllergen) {
      const filtered = allergies.filter((a) => a.name !== selectedAllergen);
      setAllergies([...filtered, { name: selectedAllergen, severity }]);
      setSelectedAllergen(null);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const toggleHealthCondition = (conditionId: string) => {
    if (healthConditions.includes(conditionId)) {
      setHealthConditions(healthConditions.filter((c) => c !== conditionId));
    } else {
      setHealthConditions([...healthConditions, conditionId]);
    }
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggleCuisine = (cuisineId: string) => {
    if (cuisinePreferences.includes(cuisineId)) {
      setCuisinePreferences(cuisinePreferences.filter((c) => c !== cuisineId));
    } else {
      setCuisinePreferences([...cuisinePreferences, cuisineId]);
    }
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiRequest("PUT", "/api/user/dietary-profile", {
        allergies,
        healthConditions,
        dietType,
        primaryGoal,
        activityLevel,
        cuisinePreferences,
        cookingSkillLevel,
        cookingTimeAvailable,
      });

      // Invalidate the dietary profile query to refresh data
      queryClient.invalidateQueries({
        queryKey: ["/api/user/dietary-profile"],
      });

      haptics.notification(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (error) {
      console.error("Failed to save dietary profile:", error);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: theme.backgroundRoot },
        ]}
      >
        <ActivityIndicator size="large" color={theme.success} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Allergies Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Allergies
          </ThemedText>
          <View style={styles.optionsGrid}>
            {COMMON_ALLERGENS.map((allergen) => {
              const allergy = allergies.find((a) => a.name === allergen.id);
              const selected = !!allergy;
              return (
                <Pressable
                  key={allergen.id}
                  onPress={() => toggleAllergen(allergen.id)}
                  accessibilityLabel={allergen.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor: selected
                        ? allergy?.severity === "severe"
                          ? withOpacity(theme.error, 0.12)
                          : allergy?.severity === "moderate"
                            ? withOpacity(theme.warning, 0.12)
                            : withOpacity(theme.success, 0.12)
                        : theme.backgroundDefault,
                      borderColor: selected
                        ? allergy?.severity === "severe"
                          ? theme.error
                          : allergy?.severity === "moderate"
                            ? theme.warning
                            : theme.success
                        : theme.border,
                    },
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{ fontWeight: selected ? "600" : "400" }}
                  >
                    {allergen.name}
                  </ThemedText>
                  {allergy && (
                    <View
                      style={[
                        styles.severityBadge,
                        {
                          backgroundColor:
                            allergy.severity === "severe"
                              ? theme.error
                              : allergy.severity === "moderate"
                                ? theme.warning
                                : theme.success,
                        },
                      ]}
                    >
                      <ThemedText
                        type="caption"
                        style={{ color: theme.buttonText, fontSize: 10 }}
                      >
                        {allergy.severity.charAt(0).toUpperCase()}
                      </ThemedText>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>

          {selectedAllergen && (
            <View
              style={[
                styles.severityModal,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Severity for{" "}
                {COMMON_ALLERGENS.find((a) => a.id === selectedAllergen)?.name}?
              </ThemedText>
              <View style={styles.severityOptions}>
                {SEVERITY_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => setSeverity(option.value)}
                    accessibilityLabel={`${option.label}: ${option.description}`}
                    style={[
                      styles.severityOption,
                      {
                        backgroundColor:
                          option.value === "severe"
                            ? withOpacity(theme.error, 0.08)
                            : option.value === "moderate"
                              ? withOpacity(theme.warning, 0.08)
                              : withOpacity(theme.success, 0.08),
                        borderColor:
                          option.value === "severe"
                            ? theme.error
                            : option.value === "moderate"
                              ? theme.warning
                              : theme.success,
                      },
                    ]}
                  >
                    <ThemedText type="small" style={{ fontWeight: "600" }}>
                      {option.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Health Conditions Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Health Conditions
          </ThemedText>
          <View style={styles.optionsList}>
            {HEALTH_CONDITIONS.map((condition) => {
              const selected = healthConditions.includes(condition.id);
              return (
                <Pressable
                  key={condition.id}
                  onPress={() => toggleHealthCondition(condition.id)}
                  accessibilityLabel={condition.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[
                    styles.listItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.success, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.success : theme.border,
                    },
                  ]}
                >
                  <View style={styles.listItemContent}>
                    <ThemedText
                      type="body"
                      style={{ fontWeight: selected ? "600" : "400" }}
                    >
                      {condition.name}
                    </ThemedText>
                    <ThemedText
                      type="caption"
                      style={{ color: theme.textSecondary }}
                    >
                      {condition.description}
                    </ThemedText>
                  </View>
                  {selected ? (
                    <Feather
                      name="check-circle"
                      size={20}
                      color={theme.success}
                    />
                  ) : (
                    <View
                      style={[styles.checkbox, { borderColor: theme.border }]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Diet Type Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Diet Type
          </ThemedText>
          <View style={styles.optionsGrid}>
            {DIET_TYPES.map((diet) => {
              const selected = dietType === diet.id;
              return (
                <Pressable
                  key={diet.id}
                  onPress={() => {
                    setDietType(dietType === diet.id ? null : diet.id);
                    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityLabel={diet.name}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.dietChip,
                    {
                      backgroundColor: selected
                        ? theme.success
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.success : theme.border,
                    },
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color: selected ? theme.buttonText : theme.text,
                      fontWeight: selected ? "600" : "400",
                    }}
                  >
                    {diet.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Goals Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Primary Goal
          </ThemedText>
          <View style={styles.goalsGrid}>
            {GOALS.map((goal) => {
              const selected = primaryGoal === goal.id;
              return (
                <Pressable
                  key={goal.id}
                  onPress={() => {
                    setPrimaryGoal(primaryGoal === goal.id ? null : goal.id);
                    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityLabel={goal.name}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.goalItem,
                    {
                      backgroundColor: selected
                        ? goal.color + "15"
                        : theme.backgroundDefault,
                      borderColor: selected ? goal.color : theme.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.goalIcon,
                      { backgroundColor: goal.color + "20" },
                    ]}
                  >
                    <Feather name={goal.icon} size={20} color={goal.color} />
                  </View>
                  <ThemedText
                    type="caption"
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

        {/* Activity Level Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Activity Level
          </ThemedText>
          <View style={styles.optionsList}>
            {ACTIVITY_LEVELS.map((level) => {
              const selected = activityLevel === level.id;
              return (
                <Pressable
                  key={level.id}
                  onPress={() => {
                    setActivityLevel(
                      activityLevel === level.id ? null : level.id,
                    );
                    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityLabel={`${level.name}: ${level.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.listItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.success, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.success : theme.border,
                    },
                  ]}
                >
                  <View style={styles.listItemContent}>
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
                      size={20}
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

        {/* Cuisine Preferences Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Favorite Cuisines
          </ThemedText>
          <View style={styles.optionsGrid}>
            {CUISINES.map((cuisine) => {
              const selected = cuisinePreferences.includes(cuisine.id);
              return (
                <Pressable
                  key={cuisine.id}
                  onPress={() => toggleCuisine(cuisine.id)}
                  accessibilityLabel={cuisine.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[
                    styles.cuisineChip,
                    {
                      backgroundColor: selected
                        ? theme.success
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.success : theme.border,
                    },
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color: selected ? theme.buttonText : theme.text,
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

        {/* Cooking Skill Level Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Cooking Skill
          </ThemedText>
          <View style={styles.optionsList}>
            {SKILL_LEVELS.map((level) => {
              const selected = cookingSkillLevel === level.id;
              return (
                <Pressable
                  key={level.id}
                  onPress={() => {
                    setCookingSkillLevel(
                      cookingSkillLevel === level.id ? null : level.id,
                    );
                    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityLabel={`${level.name}: ${level.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.listItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.success, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.success : theme.border,
                    },
                  ]}
                >
                  <View style={styles.listItemContent}>
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
                      size={20}
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

        {/* Cooking Time Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Time for Cooking
          </ThemedText>
          <View style={styles.optionsList}>
            {COOKING_TIMES.map((time) => {
              const selected = cookingTimeAvailable === time.id;
              return (
                <Pressable
                  key={time.id}
                  onPress={() => {
                    setCookingTimeAvailable(
                      cookingTimeAvailable === time.id ? null : time.id,
                    );
                    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  accessibilityLabel={`${time.name}: ${time.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.listItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.success, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.success : theme.border,
                    },
                  ]}
                >
                  <View style={styles.listItemContent}>
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
                      size={20}
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

      {/* Save Button */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: theme.backgroundRoot,
            paddingBottom: insets.bottom + Spacing.lg,
          },
        ]}
      >
        <Button
          onPress={handleSave}
          disabled={isSaving}
          accessibilityLabel={isSaving ? "Saving changes" : "Save Changes"}
          style={{ backgroundColor: theme.success }}
        >
          {isSaving ? (
            <ActivityIndicator color={theme.buttonText} size="small" />
          ) : (
            "Save Changes"
          )}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  optionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  optionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  severityBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  severityModal: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  severityOptions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  severityOption: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
  },
  dietChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  cuisineChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  goalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  goalItem: {
    width: "30%",
    flexGrow: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
    gap: Spacing.xs,
  },
  goalIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  optionsList: {
    gap: Spacing.sm,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  listItemContent: {
    flex: 1,
    gap: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.1)",
  },
});
