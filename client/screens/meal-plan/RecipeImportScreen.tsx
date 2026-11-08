import React, { useState, useCallback, useEffect, useRef } from "react";
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
import {
  useParseRecipeFromPage,
  useParseRecipeFromUrl,
} from "@/hooks/useMealPlanRecipes";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeImportScreenNavigationProp } from "@/types/navigation";
import { useFromHomeBackRedirect } from "@/hooks/useFromHomeBackRedirect";
import { useHeaderCloseButton } from "@/hooks/useHeaderCloseButton";
import { ImportWebView } from "@/lib/import-browser/ImportWebView";
import { resolveImportedUrl } from "@/lib/import-browser/import-browser-utils";
import {
  shouldTryDeviceFallback,
  urlImportErrorCopy,
} from "./recipe-import-utils";
import { useMarkFeatureUsed } from "@/hooks/useFeatureTip";

type ImportState = "idle" | "loading" | "device" | "needs-browser" | "error";

/** How long the hidden WebView gets to hand back page data. */
const DEVICE_EXTRACTION_TIMEOUT_MS = 15_000;

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
  useHeaderCloseButton(navigation, fromHome, "Close");
  const parseMutation = useParseRecipeFromUrl();
  const parsePageMutation = useParseRecipeFromPage();

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
  // The link the current attempt started from; the hidden WebView loads it.
  const [attemptUrl, setAttemptUrl] = useState("");
  // Bumped on every new attempt and on unmount, so a late parse result from an
  // abandoned attempt can neither navigate nor set state.
  const attemptRef = useRef(0);
  useEffect(() => {
    return () => {
      attemptRef.current += 1;
    };
  }, []);

  // The hidden WebView gets 15 s; after that, ask the user to sign in.
  useEffect(() => {
    if (state !== "device") return;
    const attempt = attemptRef.current;
    const timer = setTimeout(() => {
      if (attemptRef.current === attempt) setState("needs-browser");
    }, DEVICE_EXTRACTION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (state === "loading" || state === "device") {
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
    const attempt = ++attemptRef.current;
    setState("loading");
    setErrorMessage("");
    setAttemptUrl(trimmed);

    try {
      const importedData = await parseMutation.mutateAsync(trimmed);
      if (attemptRef.current !== attempt) return;
      haptics.notification(NotificationFeedbackType.Success);
      navigation.replace("RecipeCreate", {
        prefill: importedData,
        returnToMealPlan,
        fromHome,
      });
    } catch (error) {
      if (attemptRef.current !== attempt) return;
      if (shouldTryDeviceFallback(error)) {
        setState("device");
        return;
      }
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

  const handleBlocks = useCallback(
    async (blocks: string[], currentUrl: string) => {
      // An empty first page (redirect hop) is skipped; the extractor runs again
      // on each load.
      if (blocks.length === 0) return;
      const attempt = attemptRef.current;
      // Leaving "device" unmounts the WebView, so later messages can't arrive.
      setState("loading");
      try {
        const importedData = await parsePageMutation.mutateAsync({
          url: resolveImportedUrl(currentUrl, attemptUrl),
          ldJson: blocks,
        });
        if (attemptRef.current !== attempt) return;
        haptics.notification(NotificationFeedbackType.Success);
        navigation.replace("RecipeCreate", {
          prefill: importedData,
          returnToMealPlan,
          fromHome,
        });
      } catch {
        if (attemptRef.current !== attempt) return;
        setState("needs-browser");
      }
    },
    [
      attemptUrl,
      parsePageMutation,
      haptics,
      navigation,
      returnToMealPlan,
      fromHome,
    ],
  );

  const handleOpenBrowser = useCallback(() => {
    navigation.navigate("RecipeImportBrowser", {
      url: attemptUrl,
      returnToMealPlan,
      fromHome,
    });
  }, [navigation, attemptUrl, returnToMealPlan, fromHome]);

  const handlePhotoOrPaste = useCallback(() => {
    navigation.navigate("RecipeEntryHub", { returnToMealPlan });
  }, [navigation, returnToMealPlan]);

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
            <ThemedText accessibilityRole="header" style={styles.heading}>
              Import from URL
            </ThemedText>
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

        {state === "device" && (
          <ImportWebView url={attemptUrl} hidden onBlocks={handleBlocks} />
        )}

        {(state === "loading" || state === "device") && (
          <View accessibilityLiveRegion="polite" style={styles.centeredContent}>
            <ActivityIndicator size="large" color={theme.link} />
            <ThemedText
              style={[styles.loadingText, { color: theme.textSecondary }]}
            >
              Extracting recipe data...
            </ThemedText>
          </View>
        )}

        {state === "needs-browser" && (
          <View style={styles.centeredContent}>
            <View
              style={[
                styles.errorIcon,
                { backgroundColor: withOpacity(theme.link, 0.15) },
              ]}
            >
              <Feather name="lock" size={32} color={theme.link} />
            </View>
            <ThemedText accessibilityRole="header" style={styles.heading}>
              We couldn&apos;t read this recipe
            </ThemedText>
            <ThemedText
              style={[styles.errorText, { color: theme.textSecondary }]}
            >
              The site may need you to sign in. Open it here, sign in, and
              we&apos;ll import it.
            </ThemedText>
            <Pressable
              onPress={handleOpenBrowser}
              style={[
                styles.actionButton,
                styles.errorAction,
                { backgroundColor: theme.accentSolid },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Open site and sign in"
            >
              <ThemedText style={styles.actionButtonText}>
                Open site and sign in
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handlePhotoOrPaste}
              style={[
                styles.secondaryButton,
                styles.errorAction,
                { borderColor: withOpacity(theme.text, 0.15) },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Use a photo or paste instead"
            >
              <ThemedText
                style={[styles.secondaryButtonText, { color: theme.link }]}
              >
                Use a photo or paste instead
              </ThemedText>
            </Pressable>
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
            <ThemedText accessibilityRole="header" style={styles.heading}>
              Import Failed
            </ThemedText>
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
