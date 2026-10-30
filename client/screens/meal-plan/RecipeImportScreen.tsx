import React, { useState, useCallback, useEffect } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { InlineError } from "@/components/InlineError";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { NotificationFeedbackType } from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useBottomBudget } from "@/hooks/useBottomBudget";
import { useHaptics } from "@/hooks/useHaptics";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { focusFirstInvalid } from "@/lib/field-validation";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useParseRecipeFromUrl } from "@/hooks/useMealPlanRecipes";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeImportScreenNavigationProp } from "@/types/navigation";
import { useFromHomeBackRedirect } from "@/hooks/useFromHomeBackRedirect";
import { urlImportErrorCopy } from "./recipe-import-utils";
import { useMarkFeatureUsed } from "@/hooks/useFeatureTip";

type ImportState = "idle" | "loading" | "error";

type RecipeImportRouteProp = RouteProp<MealPlanStackParamList, "RecipeImport">;

export default function RecipeImportScreen() {
  // Opening this screen counts as using the feature, so its tips stop.
  useMarkFeatureUsed("import");
  const navigation = useNavigation<RecipeImportScreenNavigationProp>();
  const route = useRoute<RecipeImportRouteProp>();
  const headerHeight = useHeaderHeight();
  const bottomBudget = useBottomBudget();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const returnToMealPlan = route.params?.returnToMealPlan;
  const fromHome = route.params?.fromHome;
  useFromHomeBackRedirect(navigation, fromHome);
  const parseMutation = useParseRecipeFromUrl();

  // Import stays pressable with an empty link; pressing it names the field
  // (form-fields spec §5.1).
  const urlField = useFieldValidation((value) =>
    value.trim() === "" ? "Paste a recipe link." : null,
  );
  // Destructured, never read as `urlField.ref` in render: React Compiler
  // treats an object read through `.ref` as a ref and skips the component.
  const { ref: urlRef } = urlField;
  const url = urlField.value;
  const [state, setState] = useState<ImportState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (state === "loading") {
      AccessibilityInfo.announceForAccessibility("Extracting recipe data");
    } else if (state === "error") {
      AccessibilityInfo.announceForAccessibility(
        `Import failed: ${errorMessage}`,
      );
    }
  }, [state, errorMessage]);

  const handleImport = useCallback(async () => {
    const trimmed = url.trim();
    if (!focusFirstInvalid([urlField])) {
      haptics.notification(NotificationFeedbackType.Error);
      return;
    }

    haptics.selection();
    setState("loading");
    setErrorMessage("");

    try {
      const importedData = await parseMutation.mutateAsync(trimmed);
      haptics.notification(NotificationFeedbackType.Success);
      navigation.replace("RecipeCreate", {
        prefill: importedData,
        returnToMealPlan,
        fromHome,
      });
    } catch (error) {
      setState("error");
      haptics.notification(NotificationFeedbackType.Error);
      setErrorMessage(urlImportErrorCopy(error));
    }
  }, [
    url,
    urlField,
    haptics,
    parseMutation,
    returnToMealPlan,
    fromHome,
    navigation,
  ]);

  const handleTryAgain = useCallback(() => {
    setState("idle");
    setErrorMessage("");
  }, []);

  const handleCreateManually = useCallback(() => {
    navigation.navigate("RecipeCreate", { returnToMealPlan, fromHome });
  }, [navigation, returnToMealPlan, fromHome]);

  const inputStyle = [
    styles.urlInput,
    {
      backgroundColor: withOpacity(theme.text, 0.04),
      color: theme.text,
      borderColor: withOpacity(theme.text, 0.1),
    },
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      <View
        style={{
          flex: 1,
          paddingTop: headerHeight + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          paddingBottom: bottomBudget + Spacing.xl,
        }}
      >
        {state === "idle" && (
          <>
            <View style={styles.iconContainer}>
              <Feather
                name="link"
                size={48}
                color={withOpacity(theme.text, 0.2)}
              />
            </View>
            <ThemedText style={styles.heading}>Import from URL</ThemedText>
            <ThemedText
              style={[styles.subtitle, { color: theme.textSecondary }]}
            >
              Paste a recipe URL and we&apos;ll extract the ingredients,
              nutrition, and instructions automatically.
            </ThemedText>
            <FocusTextInput
              ref={urlRef}
              label="Recipe link"
              style={inputStyle}
              value={url}
              onChangeText={urlField.onChangeText}
              onBlur={urlField.onBlur}
              placeholder="https://example.com/recipe"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleImport}
            />
            <InlineError
              message={urlField.error}
              shakeKey={urlField.shakeKey}
            />
            {/* Never disabled: the form swaps for the loading view while
                importing, and an empty link says what's missing. */}
            <Pressable
              onPress={handleImport}
              style={[
                styles.actionButton,
                { backgroundColor: theme.accentSolid },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Import recipe"
            >
              <ThemedText style={styles.actionButtonText}>Import</ThemedText>
            </Pressable>
          </>
        )}

        {state === "loading" && (
          <View accessibilityLiveRegion="polite" style={styles.centeredContent}>
            <ActivityIndicator size="large" color={theme.link} />
            <ThemedText
              style={[styles.loadingText, { color: theme.textSecondary }]}
            >
              Extracting recipe data...
            </ThemedText>
          </View>
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
            <ThemedText style={styles.heading}>Import Failed</ThemedText>
            <ThemedText
              style={[styles.errorText, { color: theme.textSecondary }]}
            >
              {errorMessage}
            </ThemedText>
            <Pressable
              onPress={handleTryAgain}
              style={[
                styles.actionButton,
                styles.errorAction,
                { backgroundColor: theme.accentSolid },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <ThemedText style={styles.actionButtonText}>Try Again</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleCreateManually}
              style={[
                styles.secondaryButton,
                styles.errorAction,
                { borderColor: withOpacity(theme.text, 0.15) },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Create recipe manually"
            >
              <ThemedText
                style={[styles.secondaryButtonText, { color: theme.link }]}
              >
                Create Manually
              </ThemedText>
            </Pressable>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  heading: {
    fontSize: 22,
    fontFamily: FontFamily.bold,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },
  urlInput: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  actionButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  actionButtonText: {
    color: "#FFFFFF", // hardcoded — always white text on colored button
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
  errorIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  // centeredContent centres children, so buttons would shrink-wrap their label
  // and sit edge-to-edge without a gutter (QA #15) — stretch inside the padding.
  errorAction: {
    alignSelf: "stretch",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },
});
