import React, { useState, useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  ActivityIndicator,
  Image,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp, FadeIn } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { ScanFlowStepIndicator } from "@/components/ScanFlowStepIndicator";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { PreparationPicker } from "@/components/PreparationPicker";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { RecipeGenerationModal } from "@/components/RecipeGenerationModal";
import { usePhotoAnalysis } from "@/hooks/usePhotoAnalysis";
import { FoodCategory } from "@shared/constants/preparation";
import type { PhotoIntent } from "@shared/constants/preparation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { FoodItem } from "@/lib/photo-upload";

type PhotoAnalysisScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "PhotoAnalysis"
>;

type RouteParams = {
  imageUri: string;
  intent: PhotoIntent;
};

/** Confidence threshold for showing follow-up questions */
const CONFIDENCE_THRESHOLD = 0.7;

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const { theme } = useTheme();

  const getConfidenceColor = () => {
    if (confidence >= 0.8) return theme.success;
    if (confidence >= 0.6) return theme.warning;
    return theme.error;
  };

  const getConfidenceLabel = () => {
    if (confidence >= 0.8) return "High";
    if (confidence >= 0.6) return "Medium";
    return "Low";
  };

  return (
    <View
      style={[
        styles.confidenceBadge,
        { backgroundColor: withOpacity(getConfidenceColor(), 0.12) },
      ]}
      accessibilityLabel={`Confidence: ${Math.round(confidence * 100)}%`}
    >
      <ThemedText type="small" style={{ color: getConfidenceColor() }}>
        {getConfidenceLabel()} Confidence ({Math.round(confidence * 100)}%)
      </ThemedText>
    </View>
  );
}

function FoodItemCard({
  food,
  index,
  onEdit,
  reducedMotion,
  isSelected,
  onToggleSelect,
  showNutrition,
  showCheckbox,
  prepMethod,
  onPrepChange,
  isPrepLoading,
  showPrepPicker,
}: {
  food: FoodItem;
  index: number;
  onEdit: (index: number, field: "name" | "quantity", value: string) => void;
  reducedMotion: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  showNutrition: boolean;
  showCheckbox: boolean;
  prepMethod?: string;
  onPrepChange?: (method: string) => void;
  isPrepLoading?: boolean;
  showPrepPicker: boolean;
}) {
  const { theme } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(food.name);
  const [editQuantity, setEditQuantity] = useState(food.quantity);

  const handleSave = () => {
    onEdit(index, "name", editName);
    onEdit(index, "quantity", editQuantity);
    setIsEditing(false);
  };

  return (
    <Animated.View
      entering={
        reducedMotion ? undefined : FadeInUp.delay(index * 100).duration(400)
      }
    >
      <Card
        elevation={1}
        style={[styles.foodItemCard, !isSelected && styles.foodItemUnselected]}
      >
        <View style={styles.foodItemHeader}>
          {/* Checkbox (only in log intent) */}
          {showCheckbox && (
            <Pressable
              onPress={onToggleSelect}
              accessibilityLabel={
                isSelected ? `Unselect ${food.name}` : `Select ${food.name}`
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              style={styles.checkboxButton}
              hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
            >
              <Feather
                name={isSelected ? "check-square" : "square"}
                size={22}
                color={isSelected ? theme.success : theme.textSecondary}
              />
            </Pressable>
          )}

          {isEditing ? (
            <View style={styles.editFields}>
              <TextInput
                style={[
                  styles.editInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={editName}
                onChangeText={setEditName}
                placeholder="Food name"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Food name"
              />
              <TextInput
                style={[
                  styles.editInput,
                  styles.quantityInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={editQuantity}
                onChangeText={setEditQuantity}
                placeholder="Quantity"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Quantity"
              />
            </View>
          ) : (
            <View style={styles.foodItemInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {food.name}
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {food.quantity}
              </ThemedText>
            </View>
          )}
          <Pressable
            onPress={() => (isEditing ? handleSave() : setIsEditing(true))}
            accessibilityLabel={isEditing ? "Save changes" : "Edit food item"}
            accessibilityRole="button"
            style={[
              styles.editButton,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <Feather
              name={isEditing ? "check" : "edit-2"}
              size={16}
              color={theme.text}
            />
          </Pressable>
        </View>

        {showNutrition && food.nutrition && (
          <View style={[styles.nutritionRow, { borderTopColor: theme.border }]}>
            <View style={styles.nutritionItem}>
              <ThemedText type="h4" style={{ color: theme.calorieAccent }}>
                {Math.round(food.nutrition.calories)}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                cal
              </ThemedText>
            </View>
            <View style={styles.nutritionItem}>
              <ThemedText type="body" style={{ color: theme.proteinAccent }}>
                {Math.round(food.nutrition.protein)}g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                protein
              </ThemedText>
            </View>
            <View style={styles.nutritionItem}>
              <ThemedText type="body" style={{ color: theme.carbsAccent }}>
                {Math.round(food.nutrition.carbs)}g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                carbs
              </ThemedText>
            </View>
            <View style={styles.nutritionItem}>
              <ThemedText type="body" style={{ color: theme.fatAccent }}>
                {Math.round(food.nutrition.fat)}g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                fat
              </ThemedText>
            </View>
          </View>
        )}

        {food.needsClarification && food.clarificationQuestion && (
          <View
            style={[
              styles.clarificationBanner,
              { backgroundColor: withOpacity(theme.warning, 0.15) },
            ]}
          >
            <Feather name="help-circle" size={14} color={theme.warning} />
            <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
              {food.clarificationQuestion}
            </ThemedText>
          </View>
        )}

        {/* Preparation Picker (log intent only) */}
        {showPrepPicker && onPrepChange && (
          <PreparationPicker
            category={(food.category as FoodCategory) || "other"}
            selectedMethod={prepMethod || "As Served"}
            onMethodChange={onPrepChange}
            isLoading={isPrepLoading}
          />
        )}
      </Card>
    </Animated.View>
  );
}

function FollowUpModal({
  questions,
  currentIndex,
  onAnswer,
  onSkip,
}: {
  questions: string[];
  currentIndex: number;
  onAnswer: (question: string, answer: string) => void;
  onSkip: () => void;
}) {
  const { theme } = useTheme();
  const [answer, setAnswer] = useState("");

  const currentQuestion = questions[currentIndex];

  const handleSubmit = () => {
    if (answer.trim()) {
      onAnswer(currentQuestion, answer.trim());
      setAnswer("");
    }
  };

  return (
    <View
      style={[
        styles.followUpModal,
        { backgroundColor: theme.backgroundDefault },
      ]}
      accessibilityViewIsModal={true}
    >
      <View style={styles.followUpHeader}>
        <Feather name="help-circle" size={24} color={theme.info} />
        <ThemedText type="h4" style={styles.followUpTitle}>
          Quick Question
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {currentIndex + 1} of {questions.length}
        </ThemedText>
      </View>

      <ThemedText type="body" style={styles.followUpQuestion}>
        {currentQuestion}
      </ThemedText>

      <TextInput
        style={[
          styles.followUpInput,
          { backgroundColor: theme.backgroundSecondary, color: theme.text },
        ]}
        value={answer}
        onChangeText={setAnswer}
        placeholder="Type your answer..."
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Follow-up question about food"
        multiline
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
      />

      <View style={styles.followUpButtons}>
        <Pressable
          onPress={onSkip}
          accessibilityLabel="Skip question"
          accessibilityRole="button"
          style={[
            styles.skipButton,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <ThemedText type="body">Skip</ThemedText>
        </Pressable>
        <Button
          onPress={handleSubmit}
          disabled={!answer.trim()}
          style={{ flex: 1, backgroundColor: theme.success }}
        >
          Continue
        </Button>
      </View>
    </View>
  );
}

export default function PhotoAnalysisScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<PhotoAnalysisScreenNavigationProp>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();

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
    haptics,
  } = usePhotoAnalysis(imageUri, intent);

  if (isAnalyzing) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.success} />
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
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
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
              accessibilityLabel="Photo being analyzed"
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
                analysisResult.overallConfidence < CONFIDENCE_THRESHOLD && (
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
                      AI confidence is low. Please review and edit items as
                      needed.
                    </ThemedText>
                  </View>
                )}

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
                      : FadeInUp.delay(foods.length * 100 + 100).duration(400)
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
        onComplete={() => {
          setShowRecipeModal(false);
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        }}
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
  centered: {
    justifyContent: "center",
    alignItems: "center",
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
  confidenceBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  foodItemCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  foodItemUnselected: {
    opacity: 0.6,
  },
  foodItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  checkboxButton: {
    marginRight: Spacing.md,
    paddingTop: 2,
  },
  foodItemInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  editFields: {
    flex: 1,
    marginRight: Spacing.md,
    gap: Spacing.sm,
  },
  editInput: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    fontSize: 16,
  },
  quantityInput: {
    width: 120,
  },
  editButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  nutritionRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: Spacing.md,
    marginTop: Spacing.md,
    borderTopWidth: 1,
  },
  nutritionItem: {
    alignItems: "center",
  },
  clarificationBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: BorderRadius.xs,
    marginTop: Spacing.md,
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
  followUpModal: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.xl,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    shadowColor: "#000", // hardcoded — shadow color is always black
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
  },
  followUpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  followUpTitle: {
    flex: 1,
  },
  followUpQuestion: {
    marginBottom: Spacing.lg,
  },
  followUpInput: {
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: Spacing.lg,
  },
  followUpButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  skipButton: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
});
