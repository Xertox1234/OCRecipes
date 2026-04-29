import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  StyleSheet,
  View,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { SwipeableRow } from "@/components/SwipeableRow";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useReceiptScan,
  useReceiptConfirm,
  type ReceiptItem,
} from "@/hooks/useReceiptScan";
import {
  parseReceiptItemsFromOCR,
  type LocalReceiptItem,
} from "@/lib/receipt-ocr-parser";
import {
  shouldReplaceWithAIReceipt,
  mergeReceiptItems,
} from "./receipt-review-utils";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

interface EditableItem extends ReceiptItem {
  id: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  produce: "#4CAF50", // hardcoded
  meat: "#E53935", // hardcoded
  seafood: "#1E88E5", // hardcoded
  dairy: "#FFC107", // hardcoded
  bakery: "#8D6E63", // hardcoded
  grains: "#FF9800", // hardcoded
  canned: "#78909C", // hardcoded
  condiments: "#AB47BC", // hardcoded
  spices: "#F44336", // hardcoded
  frozen: "#42A5F5", // hardcoded
  beverages: "#26A69A", // hardcoded
  snacks: "#FFB300", // hardcoded
  other: "#9E9E9E", // hardcoded
};

function ItemSeparator({ color }: { color: string }) {
  return <View style={[styles.separator, { backgroundColor: color }]} />;
}

export default function ReceiptReviewScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ReceiptReview">>();

  const { photoUris, ocrTexts } = route.params;
  const scanMutation = useReceiptScan();
  const confirmMutation = useReceiptConfirm();

  const [items, setItems] = useState<EditableItem[]>([]);
  const [isPartial, setIsPartial] = useState(false);
  const [showMealPlanPrompt, setShowMealPlanPrompt] = useState(false);
  const [showUpdatedToast, setShowUpdatedToast] = useState(false);

  const dataSourceRef = useRef<"local" | "ai" | null>(null);
  const localItemsRef = useRef<LocalReceiptItem[]>([]);

  // Parse local OCR for instant skeleton preview
  useEffect(() => {
    if (!ocrTexts || ocrTexts.length === 0) return;
    const parsed = parseReceiptItemsFromOCR(ocrTexts);
    if (parsed.confidence >= 0.5 && parsed.items.length > 0) {
      localItemsRef.current = parsed.items;
      setItems(
        parsed.items.map((item, i) => ({
          name: item.rawName,
          originalName: item.rawName,
          quantity: item.quantity,
          unit: "each",
          category: "other",
          isFood: true,
          estimatedShelfLifeDays: 7,
          confidence: 0.5,
          id: `local-${i}-${item.rawName}`,
        })),
      );
      dataSourceRef.current = "local";
    }
    // ocrTexts is stable for the lifetime of this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger AI scan on mount (races with local preview)
  useEffect(() => {
    let cancelled = false;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    scanMutation.mutate(photoUris, {
      onSuccess: (result) => {
        if (cancelled) return;
        const replace =
          dataSourceRef.current === "local"
            ? shouldReplaceWithAIReceipt(localItemsRef.current, result)
            : true;

        if (replace) {
          const merged = mergeReceiptItems(localItemsRef.current, result.items);
          setItems(
            merged.map((item, i) => ({ ...item, id: `${i}-${item.name}` })),
          );
          setIsPartial(result.isPartialExtraction);
          if (dataSourceRef.current === "local") {
            setShowUpdatedToast(true);
            toastTimer = setTimeout(() => setShowUpdatedToast(false), 3000);
          }
        }
        dataSourceRef.current = "ai";
      },
      onError: () => {
        if (cancelled) return;
        // Error is surfaced via scanMutation.isError in the render path,
        // but only when no local OCR items are available as fallback.
      },
    });

    return () => {
      cancelled = true;
      if (toastTimer) clearTimeout(toastTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount
  }, []);

  const handleRemoveItem = useCallback(
    (id: string) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [haptics],
  );

  const handleUpdateName = useCallback((id: string, name: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, name } : item)),
    );
  }, []);

  const handleUpdateQuantity = useCallback((id: string, qty: string) => {
    const num = parseFloat(qty);
    if (!isNaN(num) && num >= 0) {
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, quantity: num } : item,
        ),
      );
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (items.length === 0) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Heavy);

    const confirmItems = items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      category: item.category,
      estimatedShelfLifeDays: item.estimatedShelfLifeDays,
    }));

    confirmMutation.mutate(confirmItems, {
      onSuccess: () => {
        haptics.notification(Haptics.NotificationFeedbackType.Success);
        setShowMealPlanPrompt(true);
      },
    });
  }, [items, haptics, confirmMutation]);

  const renderItem = useCallback(
    ({ item }: { item: EditableItem }) => {
      const catColor = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other;
      const expiryDays = item.estimatedShelfLifeDays;

      return (
        <SwipeableRow
          rightAction={{
            icon: "trash-2",
            label: "Remove",
            backgroundColor: theme.error,
            onAction: () => handleRemoveItem(item.id),
          }}
        >
          <View
            style={[
              styles.itemRow,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <View style={styles.itemMain}>
              <TextInput
                style={[styles.itemName, { color: theme.text }]}
                value={item.name}
                onChangeText={(text) => handleUpdateName(item.id, text)}
                placeholderTextColor={theme.textSecondary}
              />
              <ThemedText
                style={[styles.originalName, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {item.originalName}
              </ThemedText>
            </View>

            <View style={styles.itemMeta}>
              <TextInput
                style={[
                  styles.qtyInput,
                  {
                    color: theme.text,
                    borderColor: withOpacity(theme.text, 0.15),
                  },
                ]}
                value={String(item.quantity)}
                onChangeText={(text) => handleUpdateQuantity(item.id, text)}
                keyboardType="numeric"
              />

              <View
                style={[
                  styles.badge,
                  { backgroundColor: withOpacity(catColor, 0.15) },
                ]}
              >
                <ThemedText style={[styles.badgeText, { color: catColor }]}>
                  {item.category}
                </ThemedText>
              </View>

              <View
                style={[
                  styles.badge,
                  { backgroundColor: withOpacity(theme.textSecondary, 0.1) },
                ]}
              >
                <ThemedText
                  style={[styles.badgeText, { color: theme.textSecondary }]}
                >
                  ~{expiryDays}d
                </ThemedText>
              </View>
            </View>
          </View>
        </SwipeableRow>
      );
    },
    [theme, handleRemoveItem, handleUpdateName, handleUpdateQuantity],
  );

  const separatorColor = useMemo(
    () => withOpacity(theme.text, 0.08),
    [theme.text],
  );
  const renderSeparator = useCallback(
    () => <ItemSeparator color={separatorColor} />,
    [separatorColor],
  );

  // Loading state — only block if no local preview items yet
  if (scanMutation.isPending && items.length === 0) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
        ]}
      >
        <ActivityIndicator size="large" color={theme.link} />
        <ThemedText
          style={[styles.loadingText, { color: theme.textSecondary }]}
        >
          Analyzing receipt...
        </ThemedText>
        <ThemedText
          style={[styles.loadingSubtext, { color: theme.textSecondary }]}
        >
          This may take a few seconds
        </ThemedText>
      </View>
    );
  }

  // Error / failed state — only show when no local OCR items are available as fallback
  if (scanMutation.isError && items.length === 0) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
        ]}
      >
        <Feather name="alert-circle" size={48} color={theme.error} />
        <ThemedText style={[styles.errorText, { color: theme.text }]}>
          Could not read the receipt
        </ThemedText>
        <ThemedText
          style={[styles.errorSubtext, { color: theme.textSecondary }]}
        >
          Try taking a clearer photo with good lighting
        </ThemedText>
        <Pressable
          onPress={() => navigation.goBack()}
          style={[styles.retryButton, { backgroundColor: theme.link }]}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <ThemedText style={{ color: theme.buttonText, fontWeight: "600" }}>
            Try Again
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  // Success — prompt to generate meal plan
  if (showMealPlanPrompt) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
        ]}
      >
        <Feather name="check-circle" size={48} color={theme.link} />
        <ThemedText style={[styles.errorText, { color: theme.text }]}>
          Items added to pantry!
        </ThemedText>
        <ThemedText
          style={[styles.errorSubtext, { color: theme.textSecondary }]}
        >
          Would you like to generate a meal plan from your groceries?
        </ThemedText>
        <Pressable
          onPress={() => navigation.replace("ReceiptMealPlan", {})}
          style={[styles.retryButton, { backgroundColor: theme.link }]}
          accessibilityRole="button"
          accessibilityLabel="Generate meal plan"
        >
          <ThemedText style={{ color: theme.buttonText, fontWeight: "600" }}>
            Plan Meals
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => navigation.popToTop()}
          style={[styles.skipButton]}
          accessibilityRole="button"
          accessibilityLabel="Skip and go home"
        >
          <ThemedText style={{ color: theme.textSecondary, fontWeight: "500" }}>
            Skip
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  // No items extracted
  if (scanMutation.isSuccess && items.length === 0) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
        ]}
      >
        <Feather name="shopping-bag" size={48} color={theme.textSecondary} />
        <ThemedText style={[styles.errorText, { color: theme.text }]}>
          No food items found
        </ThemedText>
        <ThemedText
          style={[styles.errorSubtext, { color: theme.textSecondary }]}
        >
          The receipt might not contain recognizable food items
        </ThemedText>
        <Pressable
          onPress={() => navigation.goBack()}
          style={[styles.retryButton, { backgroundColor: theme.link }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ThemedText style={{ color: theme.buttonText, fontWeight: "600" }}>
            Go Back
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={headerHeight}
    >
      {/* Partial extraction warning */}
      {isPartial && (
        <View
          style={[
            styles.warningBanner,
            { backgroundColor: withOpacity(theme.warning, 0.15) },
          ]}
        >
          <Feather name="alert-triangle" size={16} color={theme.warning} />
          <ThemedText style={[styles.warningText, { color: theme.warning }]}>
            Some items may be missing — check the list
          </ThemedText>
        </View>
      )}

      <FlatList
        {...FLATLIST_DEFAULTS}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={renderSeparator}
      />

      {/* AI-updated toast */}
      {showUpdatedToast && (
        <Animated.View
          entering={FadeInUp}
          style={[styles.toast, { backgroundColor: theme.link }]}
          accessibilityLiveRegion="polite"
        >
          <ThemedText style={styles.toastText}>
            Updated with AI analysis
          </ThemedText>
        </Animated.View>
      )}

      {/* Bottom action bar */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: theme.backgroundSecondary,
            paddingBottom: insets.bottom + Spacing.sm,
            borderTopColor: withOpacity(theme.text, 0.08),
          },
        ]}
      >
        <Pressable
          onPress={handleConfirm}
          disabled={confirmMutation.isPending || items.length === 0}
          style={[
            styles.confirmButton,
            {
              backgroundColor: theme.link,
              opacity: confirmMutation.isPending ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${items.length} items to pantry`}
        >
          {confirmMutation.isPending ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <ThemedText
              style={[styles.confirmText, { color: theme.buttonText }]}
            >
              Add to Pantry ({items.length} items)
            </ThemedText>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  loadingText: {
    fontSize: 17,
    fontWeight: "600",
    marginTop: Spacing.lg,
  },
  loadingSubtext: {
    fontSize: 14,
    marginTop: Spacing.xs,
  },
  errorText: {
    fontSize: 17,
    fontWeight: "600",
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  errorSubtext: {
    fontSize: 14,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
  retryButton: {
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  skipButton: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  warningText: {
    fontSize: 13,
  },
  listContent: {
    paddingVertical: Spacing.sm,
  },
  separator: {
    height: 1,
    marginLeft: Spacing.md,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  itemMain: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  itemName: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
  },
  originalName: {
    fontSize: 12,
    marginTop: 2,
  },
  itemMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  qtyInput: {
    width: 40,
    fontSize: 14,
    textAlign: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  bottomBar: {
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderTopWidth: 1,
  },
  confirmButton: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  confirmText: {
    fontSize: 16,
    fontWeight: "700",
  },
  toast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  toastText: {
    color: "#FFFFFF", // hardcoded
    fontSize: 13,
    fontWeight: "600",
  },
});
