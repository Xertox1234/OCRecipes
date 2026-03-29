import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Platform, AccessibilityInfo } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system";

import { useHaptics } from "@/hooks/useHaptics";
import { INTENT_CONFIG, type PhotoIntent } from "@shared/constants/preparation";
import { useBeverageSheet } from "@/hooks/useBeverageSheet";
import { formatBeverageConfirmation } from "@/components/beverage-picker-utils";
import type { BeverageSize } from "@shared/constants/beverages";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  uploadPhotoForAnalysis,
  submitFollowUp,
  confirmPhotoAnalysis,
  calculateTotals,
  lookupNutritionByPrep,
  type FoodItem,
  type PhotoAnalysisResponse,
} from "@/lib/photo-upload";

type PhotoAnalysisScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "PhotoAnalysis"
>;

export function usePhotoAnalysis(imageUri: string, intent: PhotoIntent) {
  const navigation = useNavigation<PhotoAnalysisScreenNavigationProp>();
  const haptics = useHaptics();
  const queryClient = useQueryClient();
  const intentConfig = INTENT_CONFIG[intent];

  const [analysisResult, setAnalysisResult] =
    useState<PhotoAnalysisResponse | null>(null);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Announce errors to iOS VoiceOver (Android uses accessibilityLiveRegion)
  useEffect(() => {
    if (error && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(error);
    }
  }, [error]);

  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpIndex, setFollowUpIndex] = useState(0);

  // Track which items are selected for logging
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  // Preparation methods per food item (index → method string)
  const [prepMethods, setPrepMethods] = useState<Record<number, string>>({});
  const [prepLoading, setPrepLoading] = useState<Record<number, boolean>>({});

  // Recipe modal visibility
  const [showRecipeModal, setShowRecipeModal] = useState(false);

  // Beverage follow-up
  const [beverageConfirmation, setBeverageConfirmation] = useState<
    string | null
  >(null);
  const beverageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { open: openBeverageSheet, BeverageSheet } = useBeverageSheet();

  const handleBeverageLogged = useCallback(
    (name: string, size: BeverageSize) => {
      const msg = formatBeverageConfirmation(name, size);
      setBeverageConfirmation(msg);
      // Clear after 3 seconds
      if (beverageTimerRef.current) clearTimeout(beverageTimerRef.current);
      beverageTimerRef.current = setTimeout(
        () => setBeverageConfirmation(null),
        3000,
      );
    },
    [],
  );

  // Announce beverage confirmation to iOS VoiceOver
  // (accessibilityLiveRegion is Android-only, so pair with announceForAccessibility)
  useEffect(() => {
    if (beverageConfirmation && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(beverageConfirmation);
    }
  }, [beverageConfirmation]);

  // Refs for synchronous checks (from institutional learning: stale-closure-callback-refs)
  const isUploadingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Memory cleanup on unmount (from institutional learning: useeffect-cleanup-memory-leak)
  useFocusEffect(
    useCallback(() => {
      return () => {
        // Abort any in-flight requests
        abortControllerRef.current?.abort();

        // Clear beverage confirmation timer
        if (beverageTimerRef.current) clearTimeout(beverageTimerRef.current);

        // Clean up image URI to free memory
        if (imageUri) {
          FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(() => {
            // Ignore cleanup errors
          });
        }
      };
    }, [imageUri]),
  );

  // Initialize all items as selected when foods array populates.
  useEffect(() => {
    if (foods.length > 0) {
      setSelectedItems(new Set(foods.map((_, i) => i)));
      // Initialize prep methods to "As Served" for each food
      const initialPrep: Record<number, string> = {};
      foods.forEach((_, i) => {
        initialPrep[i] = "As Served";
      });
      setPrepMethods(initialPrep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on foods.length, not foods: avoids resetting user's selections/prep edits when food names change
  }, [foods.length]);

  // Upload and analyze photo
  useEffect(() => {
    const analyzePhoto = async () => {
      if (isUploadingRef.current) return;
      isUploadingRef.current = true;

      try {
        abortControllerRef.current = new AbortController();
        const result = await uploadPhotoForAnalysis(imageUri, intent);

        setAnalysisResult(result);
        setFoods(result.foods);

        // Show follow-up questions if confidence is low (only for log/calories)
        if (
          intentConfig.needsNutrition &&
          result.needsFollowUp &&
          result.followUpQuestions.length > 0
        ) {
          setShowFollowUp(true);
        }

        haptics.notification(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Analysis failed";
        setError(message);
        haptics.notification(Haptics.NotificationFeedbackType.Error);
      } finally {
        isUploadingRef.current = false;
        setIsAnalyzing(false);
      }
    };

    analyzePhoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot analysis on mount; haptics object is unstable (new ref each render), intentConfig derived from intent
  }, [imageUri, intent]);

  const handleEditFood = (
    index: number,
    field: "name" | "quantity",
    value: string,
  ) => {
    setFoods((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const toggleItemSelection = (index: number) => {
    haptics.selection();
    setSelectedItems((prev) => {
      const updated = new Set(prev);
      if (updated.has(index)) {
        updated.delete(index);
      } else {
        updated.add(index);
      }
      return updated;
    });
  };

  const handlePrepMethodChange = useCallback(
    async (index: number, method: string) => {
      setPrepMethods((prev) => ({ ...prev, [index]: method }));

      // "As Served" means use the original nutrition — no re-lookup needed
      if (method === "As Served") return;

      const food = foods[index];
      if (!food) return;

      const query = `${method.toLowerCase()} ${food.quantity} ${food.name}`;

      setPrepLoading((prev) => ({ ...prev, [index]: true }));
      try {
        const nutrition = await lookupNutritionByPrep(query);
        if (nutrition) {
          setFoods((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index], nutrition };
            return updated;
          });
        }
      } catch {
        // Keep previous nutrition on error
      } finally {
        setPrepLoading((prev) => ({ ...prev, [index]: false }));
      }
    },
    [foods],
  );

  const handleFollowUpAnswer = async (question: string, answer: string) => {
    if (!analysisResult) return;

    try {
      const refined = await submitFollowUp(
        analysisResult.sessionId!,
        question,
        answer,
      );
      setAnalysisResult(refined);
      setFoods(refined.foods);

      if (followUpIndex < (analysisResult.followUpQuestions.length || 0) - 1) {
        setFollowUpIndex((prev) => prev + 1);
      } else {
        setShowFollowUp(false);
      }
    } catch {
      // Continue without refinement
      setShowFollowUp(false);
    }
  };

  const handleSkipFollowUp = () => {
    if (!analysisResult) return;

    if (followUpIndex < (analysisResult.followUpQuestions.length || 0) - 1) {
      setFollowUpIndex((prev) => prev + 1);
    } else {
      setShowFollowUp(false);
    }
  };

  const handleLogSelected = async () => {
    if (!analysisResult || selectedItems.size === 0) return;

    // Filter to only selected items
    const selectedFoods = foods.filter((_, index) => selectedItems.has(index));

    // Build preparation methods array from selected items
    const preparationMethodsArr = selectedFoods
      .map((food, i) => {
        const originalIndex = foods.indexOf(food);
        const method = prepMethods[originalIndex] || "As Served";
        return { name: food.name, method };
      })
      .filter((pm) => pm.method !== "As Served");

    setIsConfirming(true);
    try {
      await confirmPhotoAnalysis({
        sessionId: analysisResult.sessionId!,
        foods: selectedFoods.map((f) => ({
          name: f.name,
          quantity: f.quantity,
          calories: f.nutrition?.calories || 0,
          protein: f.nutrition?.protein || 0,
          carbs: f.nutrition?.carbs || 0,
          fat: f.nutrition?.fat || 0,
        })),
        preparationMethods:
          preparationMethodsArr.length > 0 ? preparationMethodsArr : undefined,
        analysisIntent: intent,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/scanned-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] });

      haptics.notification(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleDone = () => {
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    navigation.goBack();
  };

  const handleGenerateRecipe = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    setShowRecipeModal(true);
  };

  // Calculate totals for only selected items (memoized to avoid recalculation on every render)
  const { selectedFoods, totals } = useMemo(() => {
    const selected = foods.filter((_, index) => selectedItems.has(index));
    return {
      selectedFoods: selected,
      totals: calculateTotals(selected),
    };
  }, [foods, selectedItems]);

  const showNutrition = intent === "log" || intent === "calories";
  const showLogButton = intent === "log";
  const showPrepPicker = intent === "log";

  // Loading text varies by intent
  const loadingText =
    intent === "identify"
      ? "Identifying foods..."
      : intent === "recipe"
        ? "Identifying ingredients..."
        : "Analyzing your meal...";

  return {
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
  };
}
