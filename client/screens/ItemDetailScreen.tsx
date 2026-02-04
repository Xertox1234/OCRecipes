import React from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { SuggestionCard, type Suggestion } from "@/components/SuggestionCard";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import type { ScannedItemResponse } from "@/types/api";

type ItemDetailRouteProp = RouteProp<
  { ItemDetail: { itemId: number } },
  "ItemDetail"
>;

interface SuggestionsResponse {
  suggestions: Suggestion[];
}

function NutritionRow({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value?: string | null;
  unit?: string;
  color?: string;
}) {
  const { theme } = useTheme();
  const displayValue = value ? Math.round(parseFloat(value)) : "—";

  return (
    <View style={styles.nutritionRow}>
      <ThemedText type="body" style={{ color: theme.textSecondary }}>
        {label}
      </ThemedText>
      <ThemedText
        type="body"
        style={[styles.nutritionValue, color ? { color } : null]}
      >
        {displayValue}
        {unit ? ` ${unit}` : ""}
      </ThemedText>
    </View>
  );
}

export default function ItemDetailScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const route = useRoute<ItemDetailRouteProp>();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { itemId } = route.params;

  const {
    data: item,
    isLoading,
    error,
  } = useQuery<ScannedItemResponse>({
    queryKey: [`/api/scanned-items/${itemId}`],
  });

  const {
    data: suggestionsData,
    isLoading: suggestionsLoading,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useQuery<SuggestionsResponse>({
    queryKey: [`/api/items/${itemId}/suggestions`],
    queryFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/items/${itemId}/suggestions`,
        { productName: item?.productName },
      );
      return response.json();
    },
    enabled: !!item,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });

  const suggestions = suggestionsData?.suggestions ?? [];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          {
            backgroundColor: theme.backgroundRoot,
            paddingTop: headerHeight + Spacing.xl,
          },
        ]}
      >
        <ActivityIndicator size="large" color={theme.success} />
      </View>
    );
  }

  if (error || !item) {
    return (
      <View
        style={[
          styles.errorContainer,
          {
            backgroundColor: theme.backgroundRoot,
            paddingTop: headerHeight + Spacing.xl,
          },
        ]}
      >
        <Feather name="alert-circle" size={48} color={theme.textSecondary} />
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Unable to load item details
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={[
        styles.container,
        {
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
    >
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn.duration(300)}
      >
        <Card elevation={2} style={styles.headerCard}>
          <View style={styles.headerContent}>
            {item.imageUrl ? (
              <Image
                source={{ uri: item.imageUrl }}
                style={styles.productImage}
              />
            ) : (
              <View
                style={[
                  styles.imagePlaceholder,
                  { backgroundColor: theme.backgroundSecondary },
                ]}
              >
                <Feather name="package" size={40} color={theme.textSecondary} />
              </View>
            )}
            <View style={styles.headerInfo}>
              <ThemedText type="h3" style={styles.productName}>
                {item.productName}
              </ThemedText>
              {item.brandName ? (
                <ThemedText
                  type="body"
                  style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
                >
                  {item.brandName}
                </ThemedText>
              ) : null}
              <ThemedText
                type="caption"
                style={{ color: theme.textSecondary, marginTop: Spacing.sm }}
              >
                Scanned {formatDate(item.scannedAt)}
              </ThemedText>
            </View>
          </View>
        </Card>
      </Animated.View>

      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(100).duration(300)
        }
      >
        <ThemedText type="h4" style={styles.sectionTitle}>
          Nutrition Facts
        </ThemedText>
        <Card elevation={1} style={styles.nutritionCard}>
          {item.servingSize ? (
            <ThemedText
              type="caption"
              style={[styles.servingSize, { color: theme.textSecondary }]}
            >
              Per serving: {item.servingSize}
            </ThemedText>
          ) : null}
          <View style={styles.caloriesRow}>
            <ThemedText type="body">Calories</ThemedText>
            <ThemedText type="h2" style={{ color: theme.calorieAccent }}>
              {item.calories ? Math.round(parseFloat(item.calories)) : "—"}
            </ThemedText>
          </View>
          <View
            style={[styles.nutritionDivider, { backgroundColor: theme.border }]}
          />
          <NutritionRow
            label="Protein"
            value={item.protein}
            unit="g"
            color={theme.proteinAccent}
          />
          <NutritionRow
            label="Carbohydrates"
            value={item.carbs}
            unit="g"
            color={theme.carbsAccent}
          />
          <NutritionRow
            label="Fat"
            value={item.fat}
            unit="g"
            color={theme.fatAccent}
          />
          {item.fiber ? (
            <NutritionRow label="Fiber" value={item.fiber} unit="g" />
          ) : null}
          {item.sugar ? (
            <NutritionRow label="Sugar" value={item.sugar} unit="g" />
          ) : null}
          {item.sodium ? (
            <NutritionRow label="Sodium" value={item.sodium} unit="mg" />
          ) : null}
        </Card>
      </Animated.View>

      <Animated.View
        entering={
          reducedMotion ? undefined : FadeInDown.delay(200).duration(300)
        }
      >
        <View style={styles.suggestionsHeader}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Ideas & Inspiration
          </ThemedText>
          {suggestionsError ? (
            <Pressable
              onPress={() => refetchSuggestions()}
              style={styles.retryButton}
              accessibilityLabel="Retry loading suggestions"
              accessibilityRole="button"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather name="refresh-cw" size={16} color={theme.success} />
              <ThemedText type="small" style={{ color: theme.success }}>
                Retry
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {suggestionsLoading ? (
          <Card elevation={1} style={styles.suggestionsLoadingCard}>
            <ActivityIndicator size="small" color={theme.success} />
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, marginTop: Spacing.md }}
            >
              Finding creative ideas...
            </ThemedText>
          </Card>
        ) : suggestionsError ? (
          <Card elevation={1} style={styles.suggestionsErrorCard}>
            <Feather name="cloud-off" size={24} color={theme.textSecondary} />
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, marginTop: Spacing.sm }}
            >
              Unable to load suggestions. Please try again.
            </ThemedText>
          </Card>
        ) : suggestions.length > 0 ? (
          <View style={styles.suggestionsList}>
            {suggestions.map((suggestion, index) => (
              <SuggestionCard
                key={`${suggestion.type}-${index}`}
                suggestion={suggestion}
                itemId={itemId}
                suggestionIndex={index}
                productName={item.productName}
              />
            ))}
          </View>
        ) : null}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
  },
  headerCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  headerContent: {
    flexDirection: "row",
    gap: Spacing.lg,
  },
  productImage: {
    width: 100,
    height: 100,
    borderRadius: BorderRadius.lg,
  },
  imagePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: BorderRadius.lg,
    justifyContent: "center",
    alignItems: "center",
  },
  headerInfo: {
    flex: 1,
    justifyContent: "center",
  },
  productName: {
    fontWeight: "700",
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  nutritionCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  servingSize: {
    marginBottom: Spacing.md,
  },
  caloriesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  nutritionDivider: {
    height: 1,
    marginVertical: Spacing.md,
  },
  nutritionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  nutritionValue: {
    fontWeight: "600",
  },
  suggestionsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.xs,
  },
  suggestionsList: {
    gap: Spacing.md,
  },
  suggestionsLoadingCard: {
    padding: Spacing["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionsErrorCard: {
    padding: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
});
