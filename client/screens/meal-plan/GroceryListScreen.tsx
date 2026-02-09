import React, { useCallback, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  SectionList,
  TextInput,
  RefreshControl,
  Share,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  useGroceryListDetail,
  useToggleGroceryItem,
  useAddManualGroceryItem,
} from "@/hooks/useGroceryList";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { GroceryListItem } from "@shared/schema";

type GroceryListScreenRoute = RouteProp<MealPlanStackParamList, "GroceryList">;

function GroceryItemRow({
  item,
  listId,
}: {
  item: GroceryListItem;
  listId: number;
}) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toggleMutation = useToggleGroceryItem();

  const handleToggle = useCallback(() => {
    haptics.selection();
    toggleMutation.mutate({
      listId,
      itemId: item.id,
      isChecked: !item.isChecked,
    });
  }, [haptics, toggleMutation, listId, item.id, item.isChecked]);

  const quantityStr = item.quantity
    ? `${parseFloat(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`
    : "";

  return (
    <Pressable
      onPress={handleToggle}
      style={styles.itemRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.isChecked ?? false }}
      accessibilityLabel={`${item.name}${quantityStr ? `, ${quantityStr}` : ""}`}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: item.isChecked
              ? theme.link
              : withOpacity(theme.text, 0.3),
            backgroundColor: item.isChecked ? theme.link : "transparent",
          },
        ]}
      >
        {item.isChecked && (
          <Feather name="check" size={12} color={theme.buttonText} />
        )}
      </View>
      <View style={styles.itemContent}>
        <ThemedText
          style={[
            styles.itemName,
            item.isChecked && {
              textDecorationLine: "line-through",
              color: theme.textSecondary,
            },
          ]}
          numberOfLines={1}
        >
          {item.name}
        </ThemedText>
        {quantityStr ? (
          <ThemedText
            style={[styles.itemQuantity, { color: theme.textSecondary }]}
          >
            {quantityStr}
          </ThemedText>
        ) : null}
      </View>
      {item.isManual && (
        <View
          style={[
            styles.manualBadge,
            { backgroundColor: withOpacity(theme.link, 0.12) },
          ]}
        >
          <ThemedText style={[styles.manualBadgeText, { color: theme.link }]}>
            manual
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

export default function GroceryListScreen() {
  const route = useRoute<GroceryListScreenRoute>();
  const { listId } = route.params;
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();

  const {
    data: list,
    isLoading,
    isRefetching,
    refetch,
  } = useGroceryListDetail(listId);
  const addItemMutation = useAddManualGroceryItem();

  const [newItemName, setNewItemName] = useState("");

  const handleAddItem = useCallback(() => {
    const name = newItemName.trim();
    if (!name) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    addItemMutation.mutate(
      { listId, name },
      { onSuccess: () => setNewItemName("") },
    );
  }, [haptics, addItemMutation, listId, newItemName]);

  const handleShare = useCallback(async () => {
    if (!list) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);

    const lines: string[] = [list.title, ""];
    const grouped = new Map<string, GroceryListItem[]>();
    for (const item of list.items) {
      const cat = item.category || "other";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(item);
    }

    for (const [category, items] of grouped) {
      lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
      for (const item of items) {
        const check = item.isChecked ? "[x]" : "[ ]";
        const qty = item.quantity
          ? ` (${parseFloat(item.quantity)}${item.unit ? ` ${item.unit}` : ""})`
          : "";
        lines.push(`${check} ${item.name}${qty}`);
      }
      lines.push("");
    }

    await Share.share({ message: lines.join("\n") });
  }, [haptics, list]);

  // Group items by category for SectionList
  const sections = React.useMemo(() => {
    if (!list?.items) return [];
    const grouped = new Map<string, GroceryListItem[]>();
    for (const item of list.items) {
      const cat = item.category || "other";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(item);
    }
    return Array.from(grouped.entries()).map(([title, data]) => ({
      title: title.charAt(0).toUpperCase() + title.slice(1),
      data,
    }));
  }, [list?.items]);

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight + Spacing.lg,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <View style={styles.skeletons}>
          <SkeletonBox width="60%" height={20} borderRadius={4} />
          <View style={{ height: Spacing.lg }} />
          {[1, 2, 3, 4, 5].map((i) => (
            <SkeletonBox
              key={i}
              width="100%"
              height={40}
              borderRadius={4}
              style={{ marginBottom: Spacing.sm }}
            />
          ))}
        </View>
      </View>
    );
  }

  if (!list) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight + Spacing.lg,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <ThemedText style={[styles.errorText, { color: theme.error }]}>
          Grocery list not found.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <GroceryItemRow item={item} listId={listId} />
        )}
        renderSectionHeader={({ section }) => (
          <View
            style={[
              styles.sectionHeader,
              { backgroundColor: theme.backgroundRoot },
            ]}
          >
            <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
          </View>
        )}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingBottom: Spacing.xl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            progressViewOffset={headerHeight}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View style={styles.titleRow}>
              <ThemedText style={styles.listTitle} numberOfLines={2}>
                {list.title}
              </ThemedText>
              <Pressable
                onPress={handleShare}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Copy list to clipboard"
              >
                <Feather name="clipboard" size={20} color={theme.link} />
              </Pressable>
            </View>
            <ThemedText
              style={[styles.itemCountText, { color: theme.textSecondary }]}
            >
              {list.items.length} items -{" "}
              {list.items.filter((i) => i.isChecked).length} checked
            </ThemedText>
          </View>
        }
        ListFooterComponent={
          <View style={styles.addItemRow}>
            <TextInput
              style={[
                styles.addItemInput,
                {
                  color: theme.text,
                  borderColor: withOpacity(theme.text, 0.15),
                  backgroundColor: withOpacity(theme.text, 0.03),
                },
              ]}
              value={newItemName}
              onChangeText={setNewItemName}
              placeholder="Add item..."
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
              onSubmitEditing={handleAddItem}
              accessibilityLabel="Add grocery item"
            />
            <Pressable
              onPress={handleAddItem}
              disabled={!newItemName.trim() || addItemMutation.isPending}
              style={[
                styles.addItemButton,
                {
                  backgroundColor: theme.link,
                  opacity:
                    !newItemName.trim() || addItemMutation.isPending ? 0.4 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add item to list"
            >
              <Feather name="plus" size={20} color={theme.buttonText} />
            </Pressable>
          </View>
        }
        stickySectionHeadersEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skeletons: {
    padding: Spacing.lg,
  },
  errorText: {
    textAlign: "center",
    padding: Spacing.lg,
  },
  listHeader: {
    marginBottom: Spacing.lg,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xs,
  },
  listTitle: {
    fontSize: 20,
    fontFamily: FontFamily.bold,
    flex: 1,
    marginRight: Spacing.sm,
  },
  itemCountText: {
    fontSize: 13,
  },
  sectionHeader: {
    paddingVertical: Spacing.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  itemContent: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
  },
  itemQuantity: {
    fontSize: 12,
    marginTop: 1,
  },
  manualBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  manualBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.medium,
  },
  addItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  addItemInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 14,
  },
  addItemButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
