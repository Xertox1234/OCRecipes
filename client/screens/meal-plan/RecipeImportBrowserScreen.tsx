import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useFromHomeBackRedirect } from "@/hooks/useFromHomeBackRedirect";
import { useParseRecipeFromPage } from "@/hooks/useMealPlanRecipes";
import { ImportWebView } from "@/lib/import-browser/ImportWebView";
import type { ImportWebViewHandle } from "@/lib/import-browser/ImportWebView";
import {
  hasRecipeBlock,
  resolveImportedUrl,
} from "@/lib/import-browser/import-browser-utils";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { RecipeImportBrowserScreenNavigationProp } from "@/types/navigation";

type RouteProps = RouteProp<MealPlanStackParamList, "RecipeImportBrowser">;

/** How long the manual Import waits for the page to answer an extraction. */
const MANUAL_EXTRACT_TIMEOUT_MS = 3_000;

const NO_RECIPE_MESSAGE =
  "No recipe on this page yet — sign in or open the recipe, then try again.";
const ON_ACCENT = "#FFFFFF"; // hardcoded — white on the accent button
const FAILED_MESSAGE = "Couldn't import this page. Please try again.";

interface PageBlocks {
  blocks: string[];
  currentUrl: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export default function RecipeImportBrowserScreen() {
  const navigation = useNavigation<RecipeImportBrowserScreenNavigationProp>();
  const route = useRoute<RouteProps>();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const parsePageMutation = useParseRecipeFromPage();

  const { url: startUrl, returnToMealPlan, fromHome } = route.params;
  useFromHomeBackRedirect(navigation, fromHome);

  const webRef = useRef<ImportWebViewHandle>(null);
  const [currentUrl, setCurrentUrl] = useState(startUrl);
  // Only the latest extraction counts; a ref so Import reads it without a
  // stale closure, plus state to drive the found bar.
  const latestRef = useRef<PageBlocks | null>(null);
  const [recipeFound, setRecipeFound] = useState(false);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const isFocused = useIsFocused();

  // One parse-page in flight; a late result after unmount must not navigate.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  // Set while a manual Import waits for its own extraction.
  const waiterRef = useRef<((page: PageBlocks | null) => void) | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      waiterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "ios" && recipeFound) {
      AccessibilityInfo.announceForAccessibility("Recipe found. Import ready.");
    }
  }, [recipeFound]);

  useEffect(() => {
    if (Platform.OS === "ios" && message) {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);

  // Android back steps back inside the site (e.g. mid sign-in); only when the
  // page has no history does the default close happen. The header X closes outright.
  useEffect(() => {
    if (Platform.OS !== "android" || !isFocused) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!canGoBack) return false;
        webRef.current?.goBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, [isFocused, canGoBack]);

  const runImport = useCallback(
    async (page: PageBlocks) => {
      if (inFlightRef.current) return;
      if (!hasRecipeBlock(page.blocks)) {
        setMessage(NO_RECIPE_MESSAGE);
        return;
      }
      inFlightRef.current = true;
      setImporting(true);
      setMessage("");
      try {
        const importedData = await parsePageMutation.mutateAsync({
          url: resolveImportedUrl(page.currentUrl, startUrl),
          ldJson: page.blocks,
        });
        if (!mountedRef.current) return;
        haptics.notification(NotificationFeedbackType.Success);
        navigation.replace("RecipeCreate", {
          prefill: importedData,
          returnToMealPlan,
          fromHome,
        });
      } catch (error) {
        if (!mountedRef.current) return;
        haptics.notification(NotificationFeedbackType.Error);
        const code = (error as { code?: string } | null)?.code;
        setMessage(
          code === "NO_RECIPE_DATA" || code === "PARSE_ERROR"
            ? NO_RECIPE_MESSAGE
            : FAILED_MESSAGE,
        );
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setImporting(false);
      }
    },
    [
      parsePageMutation,
      startUrl,
      haptics,
      navigation,
      returnToMealPlan,
      fromHome,
    ],
  );

  const handleBlocks = useCallback((blocks: string[], url: string) => {
    const page = { blocks, currentUrl: url };
    latestRef.current = page;
    setCurrentUrl(url);
    setRecipeFound(hasRecipeBlock(blocks));
    const waiter = waiterRef.current;
    waiterRef.current = null;
    waiter?.(page);
  }, []);

  const handleNavigationChange = useCallback((url: string, back: boolean) => {
    setCurrentUrl(url);
    setCanGoBack(back);
    // The found bar and blocks belong to the page they came from.
    if (url !== latestRef.current?.currentUrl) {
      latestRef.current = null;
      setRecipeFound(false);
      setMessage("");
    }
  }, []);

  const handleFoundImport = useCallback(() => {
    haptics.selection();
    if (latestRef.current) void runImport(latestRef.current);
  }, [haptics, runImport]);

  const handleManualImport = useCallback(async () => {
    if (inFlightRef.current || waiterRef.current) return;
    haptics.selection();
    setMessage("");
    const page = await new Promise<PageBlocks | null>((resolve) => {
      const timer = setTimeout(() => {
        waiterRef.current = null;
        resolve(null);
      }, MANUAL_EXTRACT_TIMEOUT_MS);
      waiterRef.current = (p) => {
        clearTimeout(timer);
        resolve(p);
      };
      webRef.current?.extract();
    });
    if (!mountedRef.current) return;
    if (!page) {
      setMessage(NO_RECIPE_MESSAGE);
      return;
    }
    await runImport(page);
  }, [haptics, runImport]);

  const handleClose = useCallback(() => {
    haptics.selection();
    navigation.goBack();
  }, [haptics, navigation]);

  const handleReload = useCallback(() => {
    haptics.selection();
    webRef.current?.reload();
  }, [haptics]);

  const domain = hostOf(currentUrl) || hostOf(startUrl);
  const secure = currentUrl.toLowerCase().startsWith("https://");
  const divider = withOpacity(theme.text, 0.1);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + Spacing.sm, borderBottomColor: divider },
        ]}
      >
        <Pressable
          onPress={handleClose}
          hitSlop={8}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Feather name="x" size={22} color={theme.text} />
        </Pressable>
        <View
          style={styles.domainWrap}
          accessible
          accessibilityLabel={`${domain}, ${secure ? "secure" : "not secure"}`}
        >
          <Feather
            name={secure ? "lock" : "unlock"}
            size={13}
            color={theme.textSecondary}
            importantForAccessibility="no"
            accessibilityElementsHidden
          />
          <ThemedText
            numberOfLines={1}
            style={[styles.domain, { color: theme.text }]}
          >
            {domain}
          </ThemedText>
        </View>
        <Pressable
          onPress={handleReload}
          hitSlop={8}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Reload page"
        >
          <Feather name="refresh-cw" size={20} color={theme.text} />
        </Pressable>
        <Pressable
          onPress={handleManualImport}
          disabled={importing}
          hitSlop={4}
          style={[styles.manualImport, { borderColor: divider }]}
          accessibilityRole="button"
          accessibilityLabel="Import"
          accessibilityState={{ disabled: importing }}
        >
          <ThemedText style={[styles.manualImportText, { color: theme.link }]}>
            Import
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.webWrap}>
        <ImportWebView
          ref={webRef}
          url={startUrl}
          onBlocks={handleBlocks}
          onNavigationChange={handleNavigationChange}
        />
      </View>

      {/* Stable live-region node; the bar and message mount inside it. */}
      <View
        accessibilityLiveRegion="polite"
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.sm }]}
      >
        {message ? (
          <ThemedText style={[styles.message, { color: theme.textSecondary }]}>
            {message}
          </ThemedText>
        ) : null}
        {recipeFound ? (
          <Pressable
            onPress={handleFoundImport}
            disabled={importing}
            style={[styles.foundBar, { backgroundColor: theme.accentSolid }]}
            accessibilityRole="button"
            accessibilityLabel="Import this recipe"
            accessibilityState={{ disabled: importing }}
          >
            {importing ? (
              <ActivityIndicator color={ON_ACCENT} />
            ) : (
              <ThemedText style={styles.foundBarText}>
                ✓ Recipe found · Import
              </ThemedText>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  domainWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  domain: { fontSize: 15, fontFamily: FontFamily.medium, flexShrink: 1 },
  manualImport: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  manualImportText: { fontSize: 14, fontFamily: FontFamily.semiBold },
  webWrap: { flex: 1 },
  footer: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  foundBar: {
    minHeight: 48,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    justifyContent: "center",
  },
  foundBarText: {
    color: "#FFFFFF", // hardcoded — always white text on colored button
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
});
