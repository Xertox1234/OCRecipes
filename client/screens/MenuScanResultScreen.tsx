import React, {
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  Typography,
  BorderRadius,
  withOpacity,
  FontFamily,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { useMenuScan, type MenuAnalysisItem } from "@/hooks/useMenuScan";
import { parseMenuFromOCR, type LocalMenuItem } from "@/lib/menu-ocr-parser";
import {
  shouldReplaceWithAIMenu,
  mergeMenuItems,
} from "./menu-scan-result-utils";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type MenuScanResultRouteProp = RouteProp<RootStackParamList, "MenuScanResult">;

// hardcoded — semantic health rating colors, not themeable
const RECOMMENDATION_STYLES: Record<
  string,
  { icon: string; color: string; label: string }
> = {
  great: { icon: "checkmark-circle", color: "#2E7D32", label: "Great Choice" }, // hardcoded
  good: { icon: "thumbs-up", color: "#1565C0", label: "Good Option" }, // hardcoded
  okay: { icon: "remove-circle-outline", color: "#F57F17", label: "Okay" }, // hardcoded
  avoid: { icon: "warning", color: "#C62828", label: "Not Ideal" }, // hardcoded
};

const MenuItemCard = React.memo(function MenuItemCard({
  item,
  isLocal,
}: {
  item: MenuAnalysisItem | LocalMenuItem;
  isLocal: boolean;
}) {
  const { theme } = useTheme();
  const isAI = !isLocal;
  const aiItem = isAI ? (item as MenuAnalysisItem) : null;
  const rec = aiItem?.recommendation
    ? RECOMMENDATION_STYLES[aiItem.recommendation]
    : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: rec ? withOpacity(rec.color, 0.19) : theme.border,
        },
      ]}
      accessibilityLabel={
        aiItem
          ? `${item.name}, ${aiItem.estimatedCalories} calories${rec ? `, ${rec.label}` : ""}`
          : item.name
      }
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <ThemedText
            style={[styles.itemName, { color: theme.text }]}
            numberOfLines={2}
          >
            {item.name}
          </ThemedText>
          {(item as MenuAnalysisItem).description ? (
            <ThemedText
              style={[styles.itemDesc, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {(item as MenuAnalysisItem).description}
            </ThemedText>
          ) : null}
        </View>
        {(item as LocalMenuItem).price ? (
          <ThemedText style={[styles.price, { color: theme.text }]}>
            {(item as LocalMenuItem).price}
          </ThemedText>
        ) : aiItem?.price ? (
          <ThemedText style={[styles.price, { color: theme.text }]}>
            {aiItem.price}
          </ThemedText>
        ) : null}
      </View>

      {aiItem ? (
        <View style={styles.macroRow}>
          <View style={styles.macro}>
            <ThemedText
              style={[styles.macroValue, { color: theme.calorieAccent }]}
            >
              {aiItem.estimatedCalories}
            </ThemedText>
            <ThemedText
              style={[styles.macroLabel, { color: theme.textSecondary }]}
            >
              cal
            </ThemedText>
          </View>
          <View style={styles.macro}>
            <ThemedText
              style={[styles.macroValue, { color: theme.proteinAccent }]}
            >
              {aiItem.estimatedProtein}g
            </ThemedText>
            <ThemedText
              style={[styles.macroLabel, { color: theme.textSecondary }]}
            >
              protein
            </ThemedText>
          </View>
          <View style={styles.macro}>
            <ThemedText
              style={[styles.macroValue, { color: theme.carbsAccent }]}
            >
              {aiItem.estimatedCarbs}g
            </ThemedText>
            <ThemedText
              style={[styles.macroLabel, { color: theme.textSecondary }]}
            >
              carbs
            </ThemedText>
          </View>
          <View style={styles.macro}>
            <ThemedText style={[styles.macroValue, { color: theme.fatAccent }]}>
              {aiItem.estimatedFat}g
            </ThemedText>
            <ThemedText
              style={[styles.macroLabel, { color: theme.textSecondary }]}
            >
              fat
            </ThemedText>
          </View>
        </View>
      ) : (
        <View style={styles.localPlaceholder}>
          <ThemedText
            style={[styles.localHint, { color: theme.textSecondary }]}
          >
            Analysing nutrition…
          </ThemedText>
        </View>
      )}

      {aiItem?.tags && aiItem.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {aiItem.tags.map((tag) => (
            <View
              key={tag}
              style={[
                styles.tag,
                { backgroundColor: withOpacity(theme.link, 0.08) },
              ]}
            >
              <ThemedText style={[styles.tagText, { color: theme.link }]}>
                {tag}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      {rec ? (
        <View
          style={[
            styles.recRow,
            { backgroundColor: withOpacity(rec.color, 0.06) },
          ]}
        >
          <Ionicons
            name={rec.icon as keyof typeof Ionicons.glyphMap}
            size={16}
            color={rec.color}
          />
          <View style={styles.recTextContainer}>
            <ThemedText style={[styles.recLabel, { color: rec.color }]}>
              {rec.label}
            </ThemedText>
            {aiItem?.recommendationReason ? (
              <ThemedText
                style={[styles.recReason, { color: theme.textSecondary }]}
              >
                {aiItem.recommendationReason}
              </ThemedText>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
});

export default function MenuScanResultScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<MenuScanResultRouteProp>();
  const { imageUri, localOCRText } = route.params;

  type DisplayItem = (MenuAnalysisItem | LocalMenuItem) & {
    _isLocal?: boolean;
  };

  const [items, setItems] = useState<DisplayItem[]>([]);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [cuisine, setCuisine] = useState<string | undefined>(undefined);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [showUpdatedToast, setShowUpdatedToast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dataSourceRef = useRef<"local" | "ai" | null>(null);
  const localItemsRef = useRef<LocalMenuItem[]>([]);

  const { mutate: scanMenu } = useMenuScan();

  // Parse local OCR text for instant preview
  useEffect(() => {
    if (!localOCRText) return;
    const parsed = parseMenuFromOCR(localOCRText);
    if (parsed.confidence >= 0.5 && parsed.items.length > 0) {
      const localDisplayItems = parsed.items.map((i) => ({
        ...i,
        _isLocal: true,
      }));
      setItems(localDisplayItems);
      localItemsRef.current = parsed.items;
      dataSourceRef.current = "local";
      if (parsed.restaurantName) setRestaurantName(parsed.restaurantName);
      setIsAnalyzing(false);
    }
  }, [localOCRText]);

  // Fetch AI analysis (always runs — races with local preview)
  useEffect(() => {
    let cancelled = false;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    scanMenu(imageUri, {
      onSuccess: (result) => {
        if (cancelled) return;
        if (result.restaurantName) setRestaurantName(result.restaurantName);
        if (result.cuisine) setCuisine(result.cuisine);

        const replace =
          dataSourceRef.current === "local"
            ? shouldReplaceWithAIMenu(localItemsRef.current, result.menuItems)
            : true;

        // Always push AI items so macros/recommendations are never hidden.
        // When replace=false, keep local item names but take AI macro fields.
        const aiDisplayItems = replace
          ? result.menuItems
          : mergeMenuItems(localItemsRef.current, result.menuItems);
        setItems(aiDisplayItems);
        if (replace && dataSourceRef.current === "local") {
          setShowUpdatedToast(true);
          toastTimer = setTimeout(() => setShowUpdatedToast(false), 3000);
          if (Platform.OS === "ios") {
            AccessibilityInfo.announceForAccessibility(
              "Updated with AI analysis",
            );
          }
        }
        dataSourceRef.current = "ai";
        setIsAnalyzing(false);
      },
      onError: (err) => {
        if (cancelled) return;
        if (dataSourceRef.current !== "local") {
          setError(
            err instanceof Error ? err.message : "Could not analyse menu",
          );
        }
        setIsAnalyzing(false);
      },
    });

    return () => {
      cancelled = true;
      if (toastTimer) clearTimeout(toastTimer);
    };
    // imageUri is stable for the lifetime of this screen — intentionally omitting scanMenu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUri]);

  const summary = useMemo(() => {
    const aiItems = items.filter(
      (i) => !(i as DisplayItem)._isLocal,
    ) as MenuAnalysisItem[];
    const great = aiItems.filter((i) => i.recommendation === "great").length;
    const good = aiItems.filter((i) => i.recommendation === "good").length;
    return { total: items.length, great, good };
  }, [items]);

  const renderItem = useCallback(
    ({ item }: { item: DisplayItem }) => (
      <MenuItemCard item={item} isLocal={!!(item as DisplayItem)._isLocal} />
    ),
    [],
  );

  const keyExtractor = useCallback(
    (item: DisplayItem, index: number) => `${item.name}-${index}`,
    [],
  );

  if (isAnalyzing && items.length === 0) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: theme.backgroundDefault },
        ]}
      >
        <ActivityIndicator
          size="large"
          color={theme.success}
          accessibilityLabel="Analysing menu"
        />
        <ThemedText
          style={[styles.analysingText, { color: theme.textSecondary }]}
        >
          Analysing menu…
        </ThemedText>
      </View>
    );
  }

  if (error && items.length === 0) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: theme.backgroundDefault },
        ]}
      >
        <ThemedText style={[styles.errorText, { color: theme.error }]}>
          {error}
        </ThemedText>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
    >
      {showUpdatedToast ? (
        <Animated.View
          entering={FadeInUp}
          style={[
            styles.toast,
            { backgroundColor: theme.success, top: insets.top + Spacing.sm },
          ]}
          accessibilityLiveRegion="polite"
        >
          <ThemedText style={styles.toastText}>
            Updated with AI analysis
          </ThemedText>
        </Animated.View>
      ) : null}

      <FlatList
        {...FLATLIST_DEFAULTS}
        data={items}
        keyExtractor={keyExtractor}
        contentContainerStyle={{
          padding: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            {restaurantName ? (
              <ThemedText
                style={[styles.restaurantName, { color: theme.text }]}
                accessibilityRole="header"
              >
                {restaurantName}
              </ThemedText>
            ) : null}
            {cuisine ? (
              <ThemedText
                style={[styles.cuisine, { color: theme.textSecondary }]}
              >
                {cuisine} cuisine
              </ThemedText>
            ) : null}
            <ThemedText
              style={[styles.summary, { color: theme.textSecondary }]}
            >
              {summary.total} items found
              {summary.great > 0 ? ` · ${summary.great} great choices` : ""}
              {summary.good > 0 ? ` · ${summary.good} good options` : ""}
            </ThemedText>
            {isAnalyzing ? (
              <View style={styles.aiProgressRow}>
                <ActivityIndicator
                  size="small"
                  color={theme.textSecondary}
                  style={styles.aiSpinner}
                />
                <ThemedText
                  style={[
                    styles.aiProgressText,
                    { color: theme.textSecondary },
                  ]}
                >
                  AI analysis in progress…
                </ThemedText>
              </View>
            ) : null}
          </View>
        }
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
  },
  analysingText: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
  },
  errorText: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    zIndex: 10,
  },
  toastText: {
    color: "#FFFFFF", // hardcoded
    fontSize: 13,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  header: {
    marginBottom: Spacing.lg,
  },
  restaurantName: {
    ...Typography.h2,
  },
  cuisine: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
    marginTop: 2,
  },
  summary: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    marginTop: Spacing.xs,
  },
  aiProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.xs,
    gap: Spacing.xs,
  },
  aiSpinner: {
    marginRight: 2,
  },
  aiProgressText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardHeaderLeft: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
  itemDesc: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    marginTop: 2,
  },
  price: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
    marginLeft: Spacing.sm,
  },
  macroRow: {
    flexDirection: "row",
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  macro: {
    alignItems: "center",
    flex: 1,
  },
  macroValue: {
    fontSize: 16,
    fontFamily: FontFamily.bold,
    fontWeight: "700",
  },
  macroLabel: {
    fontSize: 11,
    fontFamily: FontFamily.regular,
    marginTop: 1,
  },
  localPlaceholder: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  localHint: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    fontStyle: "italic",
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: Spacing.sm,
    gap: 4,
  },
  tag: {
    borderRadius: BorderRadius.tag,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  recRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.xs,
    padding: Spacing.sm,
  },
  recTextContainer: {
    marginLeft: Spacing.xs,
    flex: 1,
  },
  recLabel: {
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
    fontSize: 13,
  },
  recReason: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    marginTop: 1,
  },
});
