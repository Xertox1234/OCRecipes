import React, { useEffect } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  Pressable,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { RecipeExtractionReviewCard } from "@/components/meal-plan/RecipeExtractionReviewCard";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useRecipeExtractionFlow } from "@/hooks/useRecipeExtractionFlow";
import { useRecipeTextImport } from "@/hooks/useRecipeTextImport";
import { mapTextResultToImportedRecipeData } from "@/lib/photo-upload";
import { importErrorCopy } from "./RecipePhotoImportScreen";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeTextImportScreenNavigationProp } from "@/types/navigation";
import { useFromHomeBackRedirect } from "@/hooks/useFromHomeBackRedirect";

type RecipeTextImportRouteProp = RouteProp<
  MealPlanStackParamList,
  "RecipeTextImport"
>;

export default function RecipeTextImportScreen() {
  const navigation = useNavigation<RecipeTextImportScreenNavigationProp>();
  const route = useRoute<RecipeTextImportRouteProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const { pastedText, returnToMealPlan, fromHome } = route.params;
  useFromHomeBackRedirect(navigation, fromHome);
  const textImportMutation = useRecipeTextImport();

  const { state, result, errorMessage, retry } = useRecipeExtractionFlow({
    input: pastedText,
    mutationFn: (text) => textImportMutation.mutateAsync(text),
    gateCheck: (data) =>
      !!data.title &&
      data.ingredients.length > 0 &&
      !!data.instructions?.length,
    gateFailureMessage:
      "Could not extract a recipe from this text. Try pasting the full recipe, including ingredients and instructions.",
    errorCopy: importErrorCopy,
  });

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (state === "analyzing") {
      AccessibilityInfo.announceForAccessibility(
        "Extracting recipe from pasted text",
      );
    } else if (state === "review" && result) {
      AccessibilityInfo.announceForAccessibility(
        `Recipe extracted: ${result.title}`,
      );
    } else if (state === "error") {
      AccessibilityInfo.announceForAccessibility(
        `Import failed: ${errorMessage}`,
      );
    }
  }, [state, result, errorMessage]);

  const handleSave = () => {
    if (!result) return;
    haptics.impact();
    const prefill = mapTextResultToImportedRecipeData(result);
    navigation.replace("RecipeCreate", { prefill, returnToMealPlan, fromHome });
  };

  const handleUrlImport = () => {
    navigation.navigate("RecipeImport", { returnToMealPlan, fromHome });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
      >
        {state === "analyzing" && (
          <View accessibilityLiveRegion="polite" style={styles.centeredContent}>
            <ActivityIndicator size="large" color={theme.link} />
            <ThemedText
              style={[styles.loadingText, { color: theme.textSecondary }]}
            >
              Extracting recipe...
            </ThemedText>
          </View>
        )}

        {state === "review" && result && (
          <RecipeExtractionReviewCard result={result} onSave={handleSave} />
        )}

        {state === "error" && (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={styles.centeredContent}
          >
            <View
              style={[
                styles.errorIcon,
                { backgroundColor: withOpacity(theme.error, 0.15) },
              ]}
            >
              <Feather name="alert-circle" size={32} color={theme.error} />
            </View>
            <ThemedText style={styles.heading}>Extraction Failed</ThemedText>
            <ThemedText
              style={[styles.errorText, { color: theme.textSecondary }]}
            >
              {errorMessage}
            </ThemedText>
            <Pressable
              onPress={retry}
              style={[
                styles.actionButton,
                { backgroundColor: theme.accentSolid },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <ThemedText style={styles.actionButtonText}>Try Again</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleUrlImport}
              style={[
                styles.secondaryButton,
                { borderColor: withOpacity(theme.text, 0.15) },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Import from URL instead"
            >
              <ThemedText
                style={[styles.secondaryButtonText, { color: theme.link }]}
              >
                Import from URL
              </ThemedText>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centeredContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  loadingText: {
    fontSize: 15,
    marginTop: Spacing.lg,
  },
  heading: {
    fontSize: 22,
    fontFamily: FontFamily.bold,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  actionButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  actionButtonText: {
    color: "#FFFFFF", // hardcoded
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  secondaryButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },
});
