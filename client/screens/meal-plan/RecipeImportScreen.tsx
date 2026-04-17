import React, { useState, useCallback, useEffect } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { NotificationFeedbackType } from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { useParseRecipeFromUrl } from "@/hooks/useMealPlanRecipes";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeImportScreenNavigationProp } from "@/types/navigation";

type ImportState = "idle" | "loading" | "error";

type RecipeImportRouteProp = RouteProp<MealPlanStackParamList, "RecipeImport">;

export default function RecipeImportScreen() {
  const navigation = useNavigation<RecipeImportScreenNavigationProp>();
  const route = useRoute<RecipeImportRouteProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const returnToMealPlan = route.params?.returnToMealPlan;
  const parseMutation = useParseRecipeFromUrl();

  const [url, setUrl] = useState("");
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
    if (!trimmed) return;

    haptics.selection();
    setState("loading");
    setErrorMessage("");

    try {
      const importedData = await parseMutation.mutateAsync(trimmed);
      haptics.notification(NotificationFeedbackType.Success);
      navigation.replace("RecipeCreate", {
        prefill: importedData,
        returnToMealPlan,
      });
    } catch (error) {
      setState("error");
      haptics.notification(NotificationFeedbackType.Error);
      const msg =
        error instanceof Error ? error.message : "Failed to import recipe";
      if (msg.includes("422") || msg.includes("NO_RECIPE_DATA")) {
        setErrorMessage("No recipe data found on this page.");
      } else if (msg.includes("FETCH_FAILED")) {
        setErrorMessage(
          "Could not fetch the URL. Check the link and try again.",
        );
      } else {
        setErrorMessage("Something went wrong. Please try again.");
      }
    }
  }, [url, haptics, parseMutation, returnToMealPlan, navigation]);

  const handleTryAgain = useCallback(() => {
    setState("idle");
    setErrorMessage("");
  }, []);

  const handleCreateManually = useCallback(() => {
    navigation.navigate("RecipeCreate", { returnToMealPlan });
  }, [navigation, returnToMealPlan]);

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
          paddingBottom: insets.bottom + Spacing.xl,
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
            <TextInput
              style={inputStyle}
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com/recipe"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              accessibilityLabel="Recipe URL"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleImport}
            />
            <Pressable
              onPress={handleImport}
              disabled={!url.trim()}
              style={[
                styles.actionButton,
                {
                  backgroundColor: url.trim()
                    ? theme.link
                    : withOpacity(theme.link, 0.3),
                },
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
              style={[styles.actionButton, { backgroundColor: theme.link }]}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <ThemedText style={styles.actionButtonText}>Try Again</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleCreateManually}
              style={[
                styles.secondaryButton,
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
  errorText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.xl,
  },
});
