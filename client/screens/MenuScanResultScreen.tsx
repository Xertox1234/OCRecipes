import React, { useMemo, useCallback } from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  Typography,
  BorderRadius,
  withOpacity,
  FontFamily,
} from "@/constants/theme";
import type { MenuAnalysisItem } from "@/hooks/useMenuScan";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type MenuScanResultRouteProp = RouteProp<RootStackParamList, "MenuScanResult">;

// hardcoded — semantic health rating colors, not themeable
const RECOMMENDATION_STYLES: Record<
  string,
  { icon: string; color: string; label: string }
> = {
  great: { icon: "checkmark-circle", color: "#2E7D32", label: "Great Choice" }, // hardcoded
  good: { icon: "thumbs-up", color: "#1565C0", label: "Good Option" }, // hardcoded
  okay: {
    icon: "remove-circle-outline",
    color: "#F57F17", // hardcoded
    label: "Okay",
  },
  avoid: { icon: "warning", color: "#C62828", label: "Not Ideal" }, // hardcoded
};

const MenuItemCard = React.memo(function MenuItemCard({
  item,
}: {
  item: MenuAnalysisItem;
}) {
  const { theme } = useTheme();
  const rec = item.recommendation
    ? RECOMMENDATION_STYLES[item.recommendation]
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
      accessibilityLabel={`${item.name}, ${item.estimatedCalories} calories${rec ? `, ${rec.label}` : ""}`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text
            style={[styles.itemName, { color: theme.text }]}
            numberOfLines={2}
          >
            {item.name}
          </Text>
          {item.description ? (
            <Text
              style={[styles.itemDesc, { color: theme.textSecondary }]}
              numberOfLines={2}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
        {item.price ? (
          <Text style={[styles.price, { color: theme.text }]}>
            {item.price}
          </Text>
        ) : null}
      </View>

      <View style={styles.macroRow}>
        <View style={styles.macro}>
          <Text style={[styles.macroValue, { color: theme.calorieAccent }]}>
            {item.estimatedCalories}
          </Text>
          <Text style={[styles.macroLabel, { color: theme.textSecondary }]}>
            cal
          </Text>
        </View>
        <View style={styles.macro}>
          <Text style={[styles.macroValue, { color: theme.proteinAccent }]}>
            {item.estimatedProtein}g
          </Text>
          <Text style={[styles.macroLabel, { color: theme.textSecondary }]}>
            protein
          </Text>
        </View>
        <View style={styles.macro}>
          <Text style={[styles.macroValue, { color: theme.carbsAccent }]}>
            {item.estimatedCarbs}g
          </Text>
          <Text style={[styles.macroLabel, { color: theme.textSecondary }]}>
            carbs
          </Text>
        </View>
        <View style={styles.macro}>
          <Text style={[styles.macroValue, { color: theme.fatAccent }]}>
            {item.estimatedFat}g
          </Text>
          <Text style={[styles.macroLabel, { color: theme.textSecondary }]}>
            fat
          </Text>
        </View>
      </View>

      {item.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {item.tags.map((tag) => (
            <View
              key={tag}
              style={[
                styles.tag,
                {
                  backgroundColor: withOpacity(theme.link, 0.08),
                },
              ]}
            >
              <Text style={[styles.tagText, { color: theme.link }]}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {rec ? (
        <View
          style={[
            styles.recRow,
            {
              backgroundColor: withOpacity(rec.color, 0.06),
            },
          ]}
        >
          <Ionicons
            name={rec.icon as keyof typeof Ionicons.glyphMap}
            size={16}
            color={rec.color}
          />
          <View style={styles.recTextContainer}>
            <Text style={[styles.recLabel, { color: rec.color }]}>
              {rec.label}
            </Text>
            {item.recommendationReason ? (
              <Text style={[styles.recReason, { color: theme.textSecondary }]}>
                {item.recommendationReason}
              </Text>
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
  const { items, restaurantName, cuisine } = route.params;

  const summary = useMemo(() => {
    const great = items.filter((i) => i.recommendation === "great").length;
    const good = items.filter((i) => i.recommendation === "good").length;
    return { total: items.length, great, good };
  }, [items]);

  const renderItem = useCallback(
    ({ item }: { item: MenuAnalysisItem }) => <MenuItemCard item={item} />,
    [],
  );

  const keyExtractor = useCallback(
    (item: MenuAnalysisItem, index: number) => `${item.name}-${index}`,
    [],
  );

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
    >
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        contentContainerStyle={{
          padding: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            {restaurantName ? (
              <Text
                style={[styles.restaurantName, { color: theme.text }]}
                accessibilityRole="header"
              >
                {restaurantName}
              </Text>
            ) : null}
            {cuisine ? (
              <Text style={[styles.cuisine, { color: theme.textSecondary }]}>
                {cuisine} cuisine
              </Text>
            ) : null}
            <Text style={[styles.summary, { color: theme.textSecondary }]}>
              {summary.total} items found
              {summary.great > 0
                ? ` \u00B7 ${summary.great} great choices`
                : ""}
              {summary.good > 0 ? ` \u00B7 ${summary.good} good options` : ""}
            </Text>
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
