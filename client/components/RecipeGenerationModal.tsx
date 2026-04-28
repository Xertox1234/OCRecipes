import React, { useState, useCallback, useEffect } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  DIET_OPTIONS,
  TIME_OPTIONS,
  SERVING_OPTIONS,
  formatIngredientsContext,
} from "./recipe-generation-utils";
import { apiRequest } from "@/lib/query-client";
import type { CommunityRecipe } from "@shared/schema";

interface RecipeGenerationModalProps {
  visible: boolean;
  onClose: () => void;
  onComplete: (recipe: CommunityRecipe) => void;
  productName: string;
  barcode?: string | null;
  /** Foods detected from photo scan - used as ingredients for recipe */
  foods?: { name: string; quantity: string }[];
}

export function RecipeGenerationModal({
  visible,
  onClose,
  onComplete,
  productName,
  barcode,
  foods,
}: RecipeGenerationModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();

  const [servings, setServings] = useState(2);
  const [selectedDiets, setSelectedDiets] = useState<string[]>([]);
  const [timeConstraint, setTimeConstraint] = useState<string | undefined>(
    undefined,
  );
  const [shareToPublic, setShareToPublic] = useState(true);

  const accentColor = theme.link;
  const accentBg = withOpacity(accentColor, 0.12);

  // Generate recipe mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      // If foods are provided from photo scan, format as ingredient list
      const ingredientsContext =
        foods && foods.length > 0 ? formatIngredientsContext(foods) : undefined;

      const response = await apiRequest("POST", "/api/recipes/generate", {
        productName: ingredientsContext || productName,
        barcode,
        servings,
        dietPreferences: selectedDiets,
        timeConstraint,
        shareToPublic,
      });
      return response.json() as Promise<CommunityRecipe>;
    },
    onSuccess: (recipe) => {
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      // Reset form state so re-opening the modal starts fresh (not inheriting previous generation's preferences)
      setServings(2);
      setSelectedDiets([]);
      setTimeConstraint(undefined);
      setShareToPublic(true);
      onComplete(recipe);
    },
    onError: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    },
  });

  useEffect(() => {
    if (Platform.OS === "ios" && generateMutation.isError) {
      const msg =
        generateMutation.error instanceof Error
          ? generateMutation.error.message
          : "Recipe generation failed";
      AccessibilityInfo.announceForAccessibility(msg);
    }
  }, [generateMutation.isError, generateMutation.error]);

  const handleGenerate = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    generateMutation.mutate();
  };

  const toggleDiet = useCallback(
    (diet: string) => {
      haptics.selection();
      setSelectedDiets((prev) =>
        prev.includes(diet) ? prev.filter((d) => d !== diet) : [...prev, diet],
      );
    },
    [haptics],
  );

  const handleClose = useCallback(() => {
    if (!generateMutation.isPending) {
      onClose();
    }
  }, [generateMutation.isPending, onClose]);

  const isGenerating = generateMutation.isPending;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        accessibilityViewIsModal
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: theme.border,
              paddingTop: insets.top || Spacing.lg,
            },
          ]}
        >
          <Pressable
            onPress={handleClose}
            disabled={isGenerating}
            style={styles.closeButton}
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather
              name="x"
              size={24}
              color={isGenerating ? theme.textSecondary : theme.text}
            />
          </Pressable>
          <ThemedText type="h4" style={styles.headerTitle}>
            Generate Recipe
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Product/Ingredients Info */}
          <Card elevation={1} style={styles.productCard}>
            <View style={styles.productRow}>
              <View
                style={[
                  styles.productIcon,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <Feather
                  name={foods?.length ? "camera" : "package"}
                  size={20}
                  color={theme.textSecondary}
                />
              </View>
              <View style={styles.productInfo}>
                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary }}
                >
                  {foods?.length
                    ? `Creating recipe with ${foods.length} ingredient${foods.length !== 1 ? "s" : ""}`
                    : "Creating recipe for"}
                </ThemedText>
                <ThemedText
                  type="body"
                  style={{ fontFamily: FontFamily.semiBold }}
                  numberOfLines={2}
                >
                  {foods?.length
                    ? foods.map((f) => f.name).join(", ")
                    : productName}
                </ThemedText>
              </View>
            </View>
          </Card>

          {/* Servings */}
          <View style={styles.section}>
            <ThemedText type="body" style={styles.sectionTitle}>
              Servings
            </ThemedText>
            <View
              style={styles.optionsRow}
              accessibilityRole="radiogroup"
              accessibilityLabel="Servings"
            >
              {SERVING_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => {
                    haptics.selection();
                    setServings(option);
                  }}
                  disabled={isGenerating}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor:
                        servings === option
                          ? accentBg
                          : theme.backgroundSecondary,
                      borderColor:
                        servings === option ? accentColor : "transparent",
                    },
                  ]}
                  accessibilityLabel={`${option} servings`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: servings === option }}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color: servings === option ? accentColor : theme.text,
                      fontFamily:
                        servings === option
                          ? FontFamily.semiBold
                          : FontFamily.regular,
                    }}
                  >
                    {option}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Time Constraint */}
          <View style={styles.section}>
            <ThemedText type="body" style={styles.sectionTitle}>
              Max Cooking Time
            </ThemedText>
            <View
              style={styles.optionsRow}
              accessibilityRole="radiogroup"
              accessibilityLabel="Max cooking time"
            >
              {TIME_OPTIONS.map((option) => (
                <Pressable
                  key={option.label}
                  onPress={() => {
                    haptics.selection();
                    setTimeConstraint(option.value);
                  }}
                  disabled={isGenerating}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor:
                        timeConstraint === option.value
                          ? accentBg
                          : theme.backgroundSecondary,
                      borderColor:
                        timeConstraint === option.value
                          ? accentColor
                          : "transparent",
                    },
                  ]}
                  accessibilityLabel={`${option.label} maximum`}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: timeConstraint === option.value,
                  }}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color:
                        timeConstraint === option.value
                          ? accentColor
                          : theme.text,
                      fontFamily:
                        timeConstraint === option.value
                          ? FontFamily.semiBold
                          : FontFamily.regular,
                    }}
                  >
                    {option.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Diet Preferences */}
          <View style={styles.section}>
            <ThemedText type="body" style={styles.sectionTitle}>
              Diet Preferences
            </ThemedText>
            <View style={styles.dietGrid}>
              {DIET_OPTIONS.map((diet) => {
                const isSelected = selectedDiets.includes(diet);
                return (
                  <Pressable
                    key={diet}
                    onPress={() => toggleDiet(diet)}
                    disabled={isGenerating}
                    style={[
                      styles.dietChip,
                      {
                        backgroundColor: isSelected
                          ? accentBg
                          : theme.backgroundSecondary,
                        borderColor: isSelected ? accentColor : "transparent",
                      },
                    ]}
                    accessibilityLabel={diet}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                  >
                    {isSelected && (
                      <Feather
                        name="check"
                        size={14}
                        color={accentColor}
                        style={styles.checkIcon}
                      />
                    )}
                    <ThemedText
                      type="small"
                      style={{
                        color: isSelected ? accentColor : theme.text,
                        fontFamily: isSelected
                          ? FontFamily.semiBold
                          : FontFamily.regular,
                      }}
                    >
                      {diet}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Share to Community Toggle */}
          <View style={styles.section}>
            <Pressable
              onPress={() => {
                haptics.selection();
                setShareToPublic(!shareToPublic);
              }}
              disabled={isGenerating}
              style={[
                styles.shareToggle,
                { backgroundColor: theme.backgroundSecondary },
              ]}
              accessibilityLabel="Share to community"
              accessibilityRole="switch"
              accessibilityState={{ checked: shareToPublic }}
            >
              <View style={styles.shareToggleContent}>
                <Feather
                  name="users"
                  size={20}
                  color={shareToPublic ? accentColor : theme.textSecondary}
                />
                <View style={styles.shareToggleText}>
                  <ThemedText
                    type="body"
                    style={{ fontFamily: FontFamily.medium }}
                  >
                    Share to Community
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                  >
                    Help others discover your recipe
                  </ThemedText>
                </View>
              </View>
              <View
                style={[
                  styles.toggleTrack,
                  {
                    backgroundColor: shareToPublic
                      ? accentColor
                      : theme.backgroundTertiary,
                  },
                ]}
              >
                <View
                  style={[
                    styles.toggleThumb,
                    { transform: [{ translateX: shareToPublic ? 20 : 0 }] },
                  ]}
                />
              </View>
            </Pressable>
          </View>

          {/* Error Message */}
          {generateMutation.isError && (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={[
                styles.errorBanner,
                { backgroundColor: withOpacity(theme.error, 0.12) },
              ]}
            >
              <Feather name="alert-circle" size={16} color={theme.error} />
              <ThemedText
                type="small"
                style={{ color: theme.error, marginLeft: Spacing.sm, flex: 1 }}
              >
                {generateMutation.error instanceof Error
                  ? generateMutation.error.message
                  : "Failed to generate recipe. Please try again."}
              </ThemedText>
            </View>
          )}

          {/* Generate Button */}
          <Pressable
            onPress={handleGenerate}
            disabled={isGenerating}
            style={[
              styles.generateButton,
              {
                backgroundColor: isGenerating
                  ? theme.backgroundSecondary
                  : accentColor,
              },
            ]}
            accessibilityLabel="Generate recipe"
            accessibilityRole="button"
            accessibilityState={{ disabled: isGenerating }}
          >
            {isGenerating ? (
              <>
                <ActivityIndicator size="small" color={theme.textSecondary} />
                <ThemedText
                  type="body"
                  style={{
                    color: theme.textSecondary,
                    marginLeft: Spacing.md,
                    fontFamily: FontFamily.semiBold,
                  }}
                >
                  Generating...
                </ThemedText>
              </>
            ) : (
              <>
                <Feather name="zap" size={20} color={theme.buttonText} />
                <ThemedText
                  type="body"
                  style={{
                    color: theme.buttonText,
                    marginLeft: Spacing.sm,
                    fontFamily: FontFamily.semiBold,
                  }}
                >
                  Generate Recipe
                </ThemedText>
              </>
            )}
          </Pressable>

          {/* Generating Status */}
          {isGenerating && (
            <ThemedText
              type="caption"
              style={{
                color: theme.textSecondary,
                textAlign: "center",
                marginTop: Spacing.md,
              }}
            >
              This may take a few seconds while we create your recipe...
            </ThemedText>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },
  closeButton: {
    padding: Spacing.xs,
  },
  headerTitle: {
    fontFamily: FontFamily.semiBold,
  },
  headerSpacer: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
  },
  productCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  productIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  productInfo: {
    flex: 1,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.md,
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  optionChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
    minHeight: 44,
  },
  dietGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  dietChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
    minHeight: 44,
  },
  checkIcon: {
    marginRight: Spacing.xs,
  },
  shareToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  shareToggleContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  shareToggleText: {
    marginLeft: Spacing.md,
    flex: 1,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF", // hardcoded: toggle thumb requires static white in StyleSheet.create
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
  },
  generateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.button,
  },
});
