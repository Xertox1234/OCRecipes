import React, { useRef } from "react";
import { AccessibilityInfo, View, StyleSheet, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { SelectableTile } from "@/components/SelectableTile";
import { AllergenGrid } from "@/components/AllergenPicker";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { useDietaryProfileForm } from "@/hooks/useDietaryProfileForm";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { HEALTH_CONSENT_PROMPT } from "@/lib/health-consent";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import {
  DIET_TYPES,
  HEALTH_CONDITIONS,
  GOALS,
  ACTIVITY_LEVELS,
  COMMON_DISLIKES,
  CUISINES,
  SKILL_LEVELS,
  COOKING_TIMES,
} from "@/constants/dietary-options";

function DietaryProfileSkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <SkeletonProvider>
      <View
        accessibilityElementsHidden
        style={{ padding: Spacing.lg, gap: Spacing.xl }}
      >
        {/* Allergies section - chip grid */}
        <View style={{ gap: Spacing.md }}>
          <SkeletonBox width={100} height={20} />
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}
          >
            <SkeletonBox
              width={80}
              height={36}
              borderRadius={BorderRadius.full}
            />
            <SkeletonBox
              width={60}
              height={36}
              borderRadius={BorderRadius.full}
            />
            <SkeletonBox
              width={90}
              height={36}
              borderRadius={BorderRadius.full}
            />
            <SkeletonBox
              width={70}
              height={36}
              borderRadius={BorderRadius.full}
            />
            <SkeletonBox
              width={85}
              height={36}
              borderRadius={BorderRadius.full}
            />
          </View>
        </View>
        {/* Diet Type section - chip grid */}
        <View style={{ gap: Spacing.md }}>
          <SkeletonBox width={90} height={20} />
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm }}
          >
            <SkeletonBox
              width={75}
              height={36}
              borderRadius={BorderRadius.full}
            />
            <SkeletonBox
              width={95}
              height={36}
              borderRadius={BorderRadius.full}
            />
            <SkeletonBox
              width={65}
              height={36}
              borderRadius={BorderRadius.full}
            />
          </View>
        </View>
        {/* Activity Level section - list rows */}
        <View style={{ gap: Spacing.md }}>
          <SkeletonBox width={130} height={20} />
          <View style={{ gap: Spacing.sm }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <SkeletonBox width="70%" height={16} />
              <SkeletonBox width={20} height={20} borderRadius={10} />
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <SkeletonBox width="60%" height={16} />
              <SkeletonBox width={20} height={20} borderRadius={10} />
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <SkeletonBox width="75%" height={16} />
              <SkeletonBox width={20} height={20} borderRadius={10} />
            </View>
          </View>
        </View>
        {/* Cooking Skill section - list rows */}
        <View style={{ gap: Spacing.md }}>
          <SkeletonBox width={120} height={20} />
          <View style={{ gap: Spacing.sm }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <SkeletonBox width="55%" height={16} />
              <SkeletonBox width={20} height={20} borderRadius={10} />
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <SkeletonBox width="65%" height={16} />
              <SkeletonBox width={20} height={20} borderRadius={10} />
            </View>
          </View>
        </View>
      </View>
    </SkeletonProvider>
  );
}

export default function EditDietaryProfileScreen({
  route,
}: Partial<NativeStackScreenProps<RootStackParamList, "EditDietaryProfile">>) {
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderContentInset(Spacing.lg);
  const { theme } = useTheme();

  const {
    isLoading,
    isError,
    refetch,
    isSaving,
    saveError,
    selectedAllergen,
    allergies,
    healthConditions,
    dietType,
    setDietType,
    primaryGoal,
    setPrimaryGoal,
    activityLevel,
    setActivityLevel,
    foodDislikes,
    cuisinePreferences,
    cookingSkillLevel,
    setCookingSkillLevel,
    cookingTimeAvailable,
    setCookingTimeAvailable,
    toggleAllergen,
    setSeverity,
    toggleHealthCondition,
    toggleDislike,
    toggleCuisine,
    needsConsent,
    handleSave,
  } = useDietaryProfileForm({ addAllergen: route?.params?.addAllergen });
  const { confirm, ConfirmationModal, behindContentA11yProps } =
    useConfirmationModal();

  // No consent, no health data: ask before a save that stores a health detail.
  const handleSavePress = () => {
    if (!needsConsent) {
      void handleSave();
      return;
    }
    confirm({
      ...HEALTH_CONSENT_PROMPT,
      onConfirm: () => void handleSave(true),
    });
  };

  // Announce the error transition for screen readers (cross-platform — the
  // EmptyState container has no live region, so announceForAccessibility carries
  // both VoiceOver and TalkBack with no double-announce). Skip the mount render
  // so a screen that opens already-errored does not announce on top of focus.
  const didMountRef = useRef(false);
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (isError) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load your dietary profile. Try again.",
      );
    }
  }, [isError]);

  if (isLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: headerInset,
            paddingBottom: insets.bottom + 100,
          }}
        >
          <DietaryProfileSkeleton />
        </ScrollView>
      </View>
    );
  }

  // Error gate: the profile read failed. Block the form (and the Save button,
  // which PUTs every field) — rendering the empty form would let the user
  // overwrite their real server profile with blank defaults. Surface a retry
  // affordance instead. See docs/rules/client-state.md (phantom-baseline-write).
  if (isError) {
    return (
      <View
        style={[
          styles.container,
          styles.errorContainer,
          { backgroundColor: theme.backgroundRoot },
        ]}
        accessibilityViewIsModal
      >
        <EmptyState
          variant="temporary"
          icon="alert-circle"
          title="Couldn't load your dietary profile"
          description="Something went wrong fetching your profile. Check your connection and try again."
          actionLabel="Try Again"
          onAction={refetch}
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      accessibilityViewIsModal
    >
      <ScrollView
        // Hidden from TalkBack while the consent confirm is open
        // (accessibilityViewIsModal on the sheet is iOS-only).
        {...behindContentA11yProps}
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerInset, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Allergies Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Allergies
          </ThemedText>
          <AllergenGrid
            allergies={allergies}
            pendingAllergen={selectedAllergen}
            onToggle={toggleAllergen}
            onSeverity={setSeverity}
          />
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
                <SelectableTile
                  shape="row"
                  key={condition.id}
                  onPress={() => toggleHealthCondition(condition.id)}
                  accessibilityLabel={condition.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[
                    styles.listItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.link, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.link : theme.border,
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
                    <Feather name="check-circle" size={20} color={theme.link} />
                  ) : (
                    <View
                      style={[styles.checkbox, { borderColor: theme.border }]}
                    />
                  )}
                </SelectableTile>
              );
            })}
          </View>
        </View>

        {/* Diet Type Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Diet Type
          </ThemedText>
          <View
            style={styles.optionsGrid}
            accessibilityRole="radiogroup"
            accessibilityLabel="Diet type"
          >
            {DIET_TYPES.map((diet) => {
              const selected = dietType === diet.id;
              return (
                <SelectableTile
                  shape="chip"
                  key={diet.id}
                  onPress={() => {
                    setDietType(dietType === diet.id ? null : diet.id);
                  }}
                  accessibilityLabel={diet.name}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.dietChip,
                    {
                      backgroundColor: selected
                        ? theme.accentSolid
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.link : theme.border,
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
                </SelectableTile>
              );
            })}
          </View>
        </View>

        {/* Food Dislikes Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Food Dislikes
          </ThemedText>
          <View style={styles.optionsGrid}>
            {COMMON_DISLIKES.map((dislike) => {
              const selected = foodDislikes.includes(dislike.id);
              return (
                <SelectableTile
                  shape="chip"
                  key={dislike.id}
                  onPress={() => toggleDislike(dislike.id)}
                  accessibilityLabel={dislike.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[
                    styles.cuisineChip,
                    {
                      backgroundColor: selected
                        ? theme.errorSolid
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.errorSolid : theme.border,
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
                    {dislike.name}
                  </ThemedText>
                </SelectableTile>
              );
            })}
          </View>
        </View>

        {/* Goals Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Primary Goal
          </ThemedText>
          <View
            style={styles.goalsGrid}
            accessibilityRole="radiogroup"
            accessibilityLabel="Primary goal"
          >
            {GOALS.map((goal) => {
              const selected = primaryGoal === goal.id;
              return (
                <SelectableTile
                  key={goal.id}
                  onPress={() => {
                    setPrimaryGoal(primaryGoal === goal.id ? null : goal.id);
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
                </SelectableTile>
              );
            })}
          </View>
        </View>

        {/* Activity Level Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Activity Level
          </ThemedText>
          <View
            style={styles.optionsList}
            accessibilityRole="radiogroup"
            accessibilityLabel="Activity level"
          >
            {ACTIVITY_LEVELS.map((level) => {
              const selected = activityLevel === level.id;
              return (
                <SelectableTile
                  shape="row"
                  key={level.id}
                  onPress={() => {
                    setActivityLevel(
                      activityLevel === level.id ? null : level.id,
                    );
                  }}
                  accessibilityLabel={`${level.name}: ${level.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.listItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.link, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.link : theme.border,
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
                    <Feather name="check-circle" size={20} color={theme.link} />
                  ) : (
                    <View
                      style={[styles.radio, { borderColor: theme.border }]}
                    />
                  )}
                </SelectableTile>
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
                <SelectableTile
                  shape="chip"
                  key={cuisine.id}
                  onPress={() => toggleCuisine(cuisine.id)}
                  accessibilityLabel={cuisine.name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[
                    styles.cuisineChip,
                    {
                      backgroundColor: selected
                        ? theme.accentSolid
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.link : theme.border,
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
                </SelectableTile>
              );
            })}
          </View>
        </View>

        {/* Cooking Skill Level Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Cooking Skill
          </ThemedText>
          <View
            style={styles.optionsList}
            accessibilityRole="radiogroup"
            accessibilityLabel="Cooking skill"
          >
            {SKILL_LEVELS.map((level) => {
              const selected = cookingSkillLevel === level.id;
              return (
                <SelectableTile
                  shape="row"
                  key={level.id}
                  onPress={() => {
                    setCookingSkillLevel(
                      cookingSkillLevel === level.id ? null : level.id,
                    );
                  }}
                  accessibilityLabel={`${level.name}: ${level.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.listItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.link, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.link : theme.border,
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
                    <Feather name="check-circle" size={20} color={theme.link} />
                  ) : (
                    <View
                      style={[styles.radio, { borderColor: theme.border }]}
                    />
                  )}
                </SelectableTile>
              );
            })}
          </View>
        </View>

        {/* Cooking Time Section */}
        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Time for Cooking
          </ThemedText>
          <View
            style={styles.optionsList}
            accessibilityRole="radiogroup"
            accessibilityLabel="Time for cooking"
          >
            {COOKING_TIMES.map((time) => {
              const selected = cookingTimeAvailable === time.id;
              return (
                <SelectableTile
                  shape="row"
                  key={time.id}
                  onPress={() => {
                    setCookingTimeAvailable(
                      cookingTimeAvailable === time.id ? null : time.id,
                    );
                  }}
                  accessibilityLabel={`${time.name}: ${time.description}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.listItem,
                    {
                      backgroundColor: selected
                        ? withOpacity(theme.link, 0.08)
                        : theme.backgroundDefault,
                      borderColor: selected ? theme.link : theme.border,
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
                    <Feather name="check-circle" size={20} color={theme.link} />
                  ) : (
                    <View
                      style={[styles.radio, { borderColor: theme.border }]}
                    />
                  )}
                </SelectableTile>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {/* Save Button — a sibling of the ScrollView, so it needs its own
          spread to leave TalkBack's reach behind the consent confirm. */}
      <View
        {...behindContentA11yProps}
        style={[
          styles.footer,
          {
            backgroundColor: theme.backgroundRoot,
            paddingBottom: insets.bottom + Spacing.lg,
            borderTopColor: theme.border,
          },
        ]}
      >
        <InlineError message={saveError} style={{ marginBottom: Spacing.sm }} />
        <Button
          onPress={handleSavePress}
          loading={isSaving}
          accessibilityLabel={isSaving ? "Saving changes" : "Save Changes"}
          style={{ backgroundColor: theme.accentSolid }}
        >
          Save Changes
        </Button>
      </View>
      <ConfirmationModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  errorContainer: {
    justifyContent: "center",
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
  },
});
