import React from "react";
import { AccessibilityInfo, StyleSheet, View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius } from "@/constants/theme";
import { formatDateLong as formatDate } from "@/lib/format";
import type { ScannedItemResponse } from "@/types/api";

type ItemDetailRouteProp = RouteProp<
  { ItemDetail: { itemId: number } },
  "ItemDetail"
>;

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

function ItemDetailSkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <View accessibilityElementsHidden style={{ padding: Spacing.lg }}>
      {/* Header card */}
      <View
        style={{
          flexDirection: "row",
          gap: Spacing.lg,
          marginBottom: Spacing.xl,
        }}
      >
        <SkeletonBox width={100} height={100} borderRadius={BorderRadius.lg} />
        <View style={{ flex: 1, justifyContent: "center", gap: Spacing.sm }}>
          <SkeletonBox width="80%" height={20} />
          <SkeletonBox width="50%" height={16} />
          <SkeletonBox width="40%" height={14} />
        </View>
      </View>
      {/* Section title */}
      <SkeletonBox
        width={140}
        height={22}
        style={{ marginBottom: Spacing.md }}
      />
      {/* Nutrition card */}
      <View style={{ gap: Spacing.md }}>
        <SkeletonBox width="50%" height={14} />
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <SkeletonBox width={80} height={16} />
          <SkeletonBox width={50} height={28} />
        </View>
        <SkeletonBox width="100%" height={1} />
        <View style={{ gap: Spacing.sm }}>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <SkeletonBox width={80} height={16} />
            <SkeletonBox width={40} height={16} />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <SkeletonBox width={100} height={16} />
            <SkeletonBox width={40} height={16} />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <SkeletonBox width={40} height={16} />
            <SkeletonBox width={40} height={16} />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <SkeletonBox width={50} height={16} />
            <SkeletonBox width={40} height={16} />
          </View>
        </View>
      </View>
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

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.backgroundRoot,
          paddingTop: headerHeight + Spacing.xl,
        }}
      >
        <ItemDetailSkeleton />
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
            <FallbackImage
              source={{ uri: item.imageUrl ?? undefined }}
              style={styles.productImage}
              fallbackStyle={{
                ...styles.imagePlaceholder,
                backgroundColor: theme.backgroundSecondary,
              }}
              fallbackIcon="package"
              fallbackIconSize={40}
              accessibilityLabel={`Photo of ${item.productName}`}
            />
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.lg,
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
});
