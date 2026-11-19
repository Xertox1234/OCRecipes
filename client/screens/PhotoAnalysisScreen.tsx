import React, { useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Image,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp, FadeIn } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { ScanFlowStepIndicator } from "@/components/ScanFlowStepIndicator";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import {
  SkeletonBox,
  SkeletonLoadingRegion,
  SkeletonProvider,
} from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { getConfidenceTier } from "@/lib/confidence";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { listStaggerMaxIndex } from "@/constants/animations";
import { RecipeGenerationModal } from "@/components/RecipeGenerationModal";
import { usePhotoAnalysis } from "@/hooks/usePhotoAnalysis";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useDelayedLoadingAnnouncement } from "@/hooks/useDelayedLoadingAnnouncement";
import { ConfidenceBadge } from "@/components/photo-analysis/ConfidenceBadge";
import { FoodItemCard } from "@/components/photo-analysis/FoodItemCard";
import { FollowUpModal } from "@/components/photo-analysis/FollowUpModal";

type PhotoAnalysisScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "PhotoAnalysis"
>;

type PhotoAnalysisRouteProp = RouteProp<RootStackParamList, "PhotoAnalysis">;

export default function PhotoAnalysisScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<PhotoAnalysisScreenNavigationProp>();
  const route = useRoute<PhotoAnalysisRouteProp>();

  const { imageUri, intent } = route.params;
  const headerPaddingStyle = useMemo(
    () => ({ paddingTop: headerHeight }),
    [headerHeight],
  );

  const {
    analysisResult,
    foods,
    isAnalyzing,
    isConfirming,
    error,
    showFollowUp,
    followUpIndex,
    selectedItems,
    prepMethods,
    prepLoading,
    showRecipeModal,
    setShowRecipeModal,
    beverageConfirmation,
    openBeverageSheet,
    BeverageSheet,
    handleBeverageLogged,
    handleEditFood,
    toggleItemSelection,
    handlePrepMethodChange,
    handleFollowUpAnswer,
    handleSkipFollowUp,
    handleLogSelected,
    handleDone,
    handleGenerateRecipe,
    selectedFoods,
    totals,
    showNutrition,
    showLogButton,
    showPrepPicker,
    loadingText,
  } = usePhotoAnalysis(imageUri, intent);

  // Tell screen-reader users the photo is being analyzed. Delayed 500ms
  // since this route is `presentation: "modal"` — an immediate announce
  // races the OS's own present-focus-shift (docs/solutions/conventions/
  // on-open-announce-must-delay-past-modal-present-focus-shift-2026-06-25.md).
  useDelayedLoadingAnnouncement(isAnalyzing);

  if (isAnalyzing) {
    return (
      <ThemedView style={styles.container} accessibilityViewIsModal>
        <View style={headerPaddingStyle}>
          <ScanFlowStepIndicator currentStep={3} totalSteps={3} />
        </View>
        <View style={styles.analysisLoadingContainer}>
          <ThemedText
            type="body"
            style={[styles.loadingText, { color: theme.textSecondary }]}
          >
            {loadingText}
          </ThemedText>
          <ThemedText
            type="small"
            style={[styles.loadingSubtext, { color: theme.textSecondary }]}
          >
            This may take a few seconds
          </ThemedText>
          <SkeletonProvider>
            <SkeletonLoadingRegion
              style={styles.analysisSkeleton}
              testID="photo-analysis-loading-skeleton"
            >
              {/* Food item rows */}
              {[1, 2, 3].map((i) => (
                <View key={i} style={styles.analysisSkeletonRow}>
                  <SkeletonBox
                    width={48}
                    height={48}
                    borderRadius={BorderRadius.sm}
                  />
                  <View style={styles.analysisSkeletonText}>
                    <SkeletonBox width="70%" height={16} />
                    <SkeletonBox width="40%" height={14} />
                  </View>
                </View>
              ))}
              {/* Nutrition summary */}
              <SkeletonBox
                width="100%"
                height={80}
                borderRadius={BorderRadius.md}
                style={{ marginTop: Spacing.lg }}
              />
            </SkeletonLoadingRegion>
          </SkeletonProvider>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container} accessibilityViewIsModal>
      <View style={headerPaddingStyle}>
        <ScanFlowStepIndicator currentStep={3} totalSteps={3} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: Spacing.xl,
              paddingBottom: insets.bottom + Spacing["3xl"],
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Photo Preview */}
          <Animated.View
            entering={reducedMotion ? undefined : FadeIn.duration(400)}
            style={styles.imageContainer}
          >
            <Image
              source={{ uri: imageUri }}
              style={styles.productImage}
              resizeMode="cover"
              // Decorative: the user just took this photo.
              accessible={false}
              importantForAccessibility="no"
            />
          </Animated.View>

          {/* Error State */}
          {error && (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={[
                styles.errorContainer,
                { backgroundColor: withOpacity(theme.error, 0.12) },
              ]}
            >
              <Feather name="alert-circle" size={20} color={theme.error} />
              <ThemedText type="body" style={{ color: theme.error, flex: 1 }}>
                {error}
              </ThemedText>
              <Pressable
                onPress={() => navigation.goBack()}
                accessibilityLabel="Try again"
                accessibilityRole="button"
              >
                <ThemedText type="small" style={{ color: theme.link }}>
                  Try Again
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* Analysis Results */}
          {analysisResult && (
            <>
              <View style={styles.resultsHeader}>
                <ThemedText type="h3">
                  {intent === "recipe" ? "Ingredients Found" : "Foods Detected"}
                </ThemedText>
                {showNutrition && (
                  <ConfidenceBadge
                    confidence={analysisResult.overallConfidence}
                  />
                )}
              </View>

              {showNutrition &&
                (() => {
                  const overallTier = getConfidenceTier(
                    analysisResult.overallConfidence,
                  );
                  if (overallTier === "high") return null;
                  return (
                    <View
                      style={[
                        styles.warningBanner,
                        { backgroundColor: withOpacity(theme.warning, 0.15) },
                      ]}
                    >
                      <Feather
                        name="alert-triangle"
                        size={16}
                        color={theme.warning}
                      />
                      <ThemedText
                        type="small"
                        style={{ color: theme.warning, flex: 1 }}
                      >
                        {overallTier === "low"
                          ? "AI confidence is low. Please review and edit items as needed."
                          : "AI confidence isn't high. Please review and edit items as needed."}
                      </ThemedText>
                    </View>
                  );
                })()}

              {/* Food Items */}
              {foods.map((food, index) => (
                <FoodItemCard
                  key={`${food.name}-${index}`}
                  food={food}
                  index={index}
                  onEdit={handleEditFood}
                  reducedMotion={reducedMotion}
                  isSelected={selectedItems.has(index)}
                  onToggleSelect={() => toggleItemSelection(index)}
                  showNutrition={showNutrition}
                  showCheckbox={showLogButton}
                  showPrepPicker={showPrepPicker}
                  prepMethod={prepMethods[index]}
                  onPrepChange={(method) =>
                    handlePrepMethodChange(index, method)
                  }
                  isPrepLoading={prepLoading[index]}
                />
              ))}

              {/* Totals Card (only for nutrition intents) */}
              {showNutrition && (
                <Animated.View
                  entering={
                    reducedMotion
                      ? undefined
                      : // Capped like the items, so it follows the last
                        // card even on a photo with many foods.
                        FadeInUp.delay(
                          Math.min(foods.length, listStaggerMaxIndex) * 100 +
                            100,
                        ).duration(400)
                  }
                >
                  <Card
                    elevation={2}
                    style={[
                      styles.totalsCard,
                      { borderColor: theme.calorieAccent, borderWidth: 2 },
                    ]}
                  >
                    <View style={styles.totalsTitleRow}>
                      <ThemedText type="h4">
                        {showLogButton ? "Meal Totals" : "Nutrition Summary"}
                      </ThemedText>
                      {showLogButton && (
                        <ThemedText
                          type="small"
                          style={{ color: theme.textSecondary }}
                        >
                          ({selectedItems.size} of {foods.length} items)
                        </ThemedText>
                      )}
                    </View>
                    <View style={styles.totalsGrid}>
                      <View style={styles.totalItem}>
                        <ThemedText
                          type="h2"
                          style={{ color: theme.calorieAccent }}
                        >
                          {Math.round(totals.calories)}
                        </ThemedText>
                        <ThemedText
                          type="small"
                          style={{ color: theme.textSecondary }}
                        >
                          calories
                        </ThemedText>
                      </View>
                      <View style={styles.totalItem}>
                        <ThemedText
                          type="h4"
                          style={{ color: theme.proteinAccent }}
                        >
                          {Math.round(totals.protein)}g
                        </ThemedText>
                        <ThemedText
                          type="small"
                          style={{ color: theme.textSecondary }}
                        >
                          protein
                        </ThemedText>
                      </View>
                      <View style={styles.totalItem}>
                        <ThemedText
                          type="h4"
                          style={{ color: theme.carbsAccent }}
                        >
                          {Math.round(totals.carbs)}g
                        </ThemedText>
                        <ThemedText
                          type="small"
                          style={{ color: theme.textSecondary }}
                        >
                          carbs
                        </ThemedText>
                      </View>
                      <View style={styles.totalItem}>
                        <ThemedText
                          type="h4"
                          style={{ color: theme.fatAccent }}
                        >
                          {Math.round(totals.fat)}g
                        </ThemedText>
                        <ThemedText
                          type="small"
                          style={{ color: theme.textSecondary }}
                        >
                          fat
                        </ThemedText>
                      </View>
                    </View>
                  </Card>
                </Animated.View>
              )}

              {/* Action Bar */}
              <View style={styles.actionBar}>
                {/* Log intent: Log button */}
                {showLogButton && (
                  <>
                    <Button
                      onPress={handleLogSelected}
                      disabled={selectedItems.size === 0}
                      loading={isConfirming}
                      accessibilityLabel={`Log ${selectedItems.size} items to today`}
                      style={[
                        styles.primaryButton,
                        { backgroundColor: theme.success },
                      ]}
                    >
                      {`Log ${selectedItems.size} Item${selectedItems.size !== 1 ? "s" : ""} to Today`}
                    </Button>

                    <Button
                      variant="outline"
                      onPress={() =>
                        openBeverageSheet({
                          mealType: null,
                          onLogged: handleBeverageLogged,
                        })
                      }
                      accessibilityLabel="Add a beverage"
                    >
                      Add Beverage
                    </Button>

                    {beverageConfirmation && (
                      <ThemedText
                        type="caption"
                        style={[
                          styles.beverageConfirmation,
                          { color: theme.success },
                        ]}
                        accessibilityLiveRegion="polite"
                      >
                        {beverageConfirmation}
                      </ThemedText>
                    )}
                  </>
                )}

                {/* Recipe intent: Generate Recipe button */}
                {intent === "recipe" && (
                  <Button
                    onPress={handleGenerateRecipe}
                    accessibilityLabel="Generate recipe from detected ingredients"
                    style={[
                      styles.primaryButton,
                      { backgroundColor: theme.success },
                    ]}
                  >
                    Generate Recipe
                  </Button>
                )}

                {/* Non-logging intents: Done button */}
                {!showLogButton && (
                  <Button
                    onPress={handleDone}
                    accessibilityLabel="Done"
                    style={[
                      styles.primaryButton,
                      {
                        backgroundColor: theme.backgroundSecondary,
                      },
                    ]}
                  >
                    Done
                  </Button>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {/* Beverage Picker Sheet */}
        <BeverageSheet />

        {/* Follow-up Questions Modal */}
        {showFollowUp && analysisResult?.followUpQuestions && (
          <FollowUpModal
            questions={analysisResult.followUpQuestions}
            currentIndex={followUpIndex}
            onAnswer={handleFollowUpAnswer}
            onSkip={handleSkipFollowUp}
          />
        )}
      </KeyboardAvoidingView>

      {/* Recipe Generation Modal */}
      <RecipeGenerationModal
        visible={showRecipeModal}
        onClose={() => setShowRecipeModal(false)}
        productName={foods.map((f) => f.name).join(", ")}
        foods={selectedFoods.map((f) => ({
          name: f.name,
          quantity: f.quantity,
        }))}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  analysisLoadingContainer: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing["2xl"],
  },
  analysisSkeleton: {
    width: "100%",
    marginTop: Spacing["2xl"],
    gap: Spacing.md,
  },
  analysisSkeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  analysisSkeletonText: {
    flex: 1,
    gap: Spacing.xs,
  },
  loadingText: {
    marginTop: Spacing.lg,
  },
  loadingSubtext: {
    marginTop: Spacing.xs,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  imageContainer: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  productImage: {
    width: "100%",
    height: 200,
    borderRadius: BorderRadius.lg,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  totalsCard: {
    padding: Spacing["2xl"],
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  totalsTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  totalsGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  totalItem: {
    alignItems: "center",
  },
  actionBar: {
    marginTop: Spacing.xl,
    gap: Spacing.md,
  },
  primaryButton: {
    marginTop: Spacing.sm,
  },
  beverageConfirmation: {
    textAlign: "center",
    fontSize: 13,
    marginTop: Spacing.xs,
  },
});
