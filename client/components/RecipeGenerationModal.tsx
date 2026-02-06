import React, { useState, useCallback } from "react";
import {
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
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
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

const DIET_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Gluten-Free",
  "Low-Carb",
  "Keto",
  "Dairy-Free",
  "Kid-Friendly",
  "Quick & Easy",
];

const TIME_OPTIONS = [
  { label: "15 min", value: "15 minutes" },
  { label: "30 min", value: "30 minutes" },
  { label: "45 min", value: "45 minutes" },
  { label: "1 hour", value: "1 hour" },
  { label: "Any", value: undefined },
];

const SERVING_OPTIONS = [1, 2, 4, 6, 8];

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

  // Purple accent
  const accentColor = "#9372F1";
  const accentBg = withOpacity(accentColor, 0.12);

  // Generate recipe mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      // If foods are provided from photo scan, format as ingredient list
      const ingredientsContext =
        foods && foods.length > 0
          ? foods.map((f) => `${f.name} (${f.quantity})`).join(", ")
          : undefined;

      const response = await apiRequest("POST", "/api/recipes/generate", {
        productName: ingredientsContext || productName,
        barcode,
        servings,
        dietPreferences: selectedDiets,
        timeConstraint,
        // Pass foods as structured data if the API supports it
        ingredients: foods,
      });
      return response.json() as Promise<CommunityRecipe>;
    },
    onSuccess: async (recipe) => {
      haptics.notification(Haptics.NotificationFeedbackType.Success);

      // If user wants to share, update the recipe
      if (shareToPublic) {
        try {
          await apiRequest("POST", `/api/recipes/${recipe.id}/share`, {
            isPublic: true,
          });
        } catch (error) {
          console.error("Failed to share recipe:", error);
        }
      }

      onComplete(recipe);
    },
    onError: (error) => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      console.error("Recipe generation error:", error);
    },
  });

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
                  style={{ fontWeight: "600" }}
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
            <View style={styles.optionsRow}>
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: servings === option }}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color: servings === option ? accentColor : theme.text,
                      fontWeight: servings === option ? "600" : "400",
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
            <View style={styles.optionsRow}>
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
                  accessibilityRole="button"
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
                      fontWeight:
                        timeConstraint === option.value ? "600" : "400",
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
                        fontWeight: isSelected ? "600" : "400",
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
                  <ThemedText type="body" style={{ fontWeight: "500" }}>
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
                    fontWeight: "600",
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
                    fontWeight: "600",
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
              This may take up to 30 seconds while we create your recipe and
              generate an image...
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
    fontWeight: "600",
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
    fontWeight: "600",
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
    backgroundColor: "#FFFFFF",
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
