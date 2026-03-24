import React, { useCallback, useMemo, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  SectionList,
  TextInput,
  RefreshControl,
  Alert,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SwipeableRow } from "@/components/SwipeableRow";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  usePantryItems,
  useCreatePantryItem,
  useDeletePantryItem,
} from "@/hooks/usePantry";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { PantryItem } from "@shared/schema";

function getExpirationBadge(expiresAt: string | Date | null) {
  if (!expiresAt) return null;
  const now = new Date();
  const exp = new Date(expiresAt);
  const daysUntil = Math.ceil(
    (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysUntil < 0) return { label: "Expired", color: "red" as const };
  if (daysUntil <= 3) return { label: `${daysUntil}d`, color: "red" as const };
  if (daysUntil <= 7)
    return { label: `${daysUntil}d`, color: "yellow" as const };
  return null;
}

function PantryItemRow({
  item,
  onDelete,
}: {
  item: PantryItem;
  onDelete: (id: number) => void;
}) {
  const { theme } = useTheme();

  const quantityStr = item.quantity
    ? `${parseFloat(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`
    : "";

  const badge = getExpirationBadge(item.expiresAt);

  return (
    <View style={styles.itemRow}>
      <View style={styles.itemContent}>
        <ThemedText style={styles.itemName} numberOfLines={1}>
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
      {badge && (
        <View
          style={[
            styles.expiryBadge,
            {
              backgroundColor:
                badge.color === "red"
                  ? withOpacity(theme.error, 0.12)
                  : withOpacity(theme.calorieAccent, 0.12),
            },
          ]}
        >
          <ThemedText
            style={[
              styles.expiryBadgeText,
              {
                color:
                  badge.color === "red" ? theme.error : theme.calorieAccent,
              },
            ]}
          >
            {badge.label}
          </ThemedText>
        </View>
      )}
      <Pressable
        onPress={() => onDelete(item.id)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${item.name}`}
      >
        <Feather name="trash-2" size={16} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

export default function PantryScreen() {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { features } = usePremiumContext();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");

  const {
    data: pantryItems,
    isLoading,
    isRefetching,
    refetch,
  } = usePantryItems();
  const createMutation = useCreatePantryItem();
  const deleteMutation = useDeletePantryItem();

  const handleAddItem = useCallback(() => {
    const name = newItemName.trim();
    if (!name) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    createMutation.mutate({ name }, { onSuccess: () => setNewItemName("") });
  }, [haptics, createMutation, newItemName]);

  const handleDelete = useCallback(
    (id: number) => {
      haptics.selection();
      Alert.alert("Remove Item", "Remove this item from your pantry?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => deleteMutation.mutate(id),
        },
      ]);
    },
    [haptics, deleteMutation],
  );

  // Group by category
  const sections = useMemo(() => {
    if (!pantryItems?.length) return [];
    const grouped = new Map<string, PantryItem[]>();
    for (const item of pantryItems) {
      const cat = item.category || "other";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(item);
    }
    return Array.from(grouped.entries()).map(([title, data]) => ({
      title: title.charAt(0).toUpperCase() + title.slice(1),
      data,
    }));
  }, [pantryItems]);

  // Premium gate
  if (!features.pantryTracking) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight + Spacing.xl,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <View style={styles.emptyState}>
          <Feather name="lock" size={48} color={withOpacity(theme.text, 0.2)} />
          <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
            Pantry Tracking
          </ThemedText>
          <ThemedText
            style={[styles.emptySubtitle, { color: theme.textSecondary }]}
          >
            Track your pantry items, get expiration alerts, and auto-deduct from
            grocery lists. Upgrade to premium to unlock.
          </ThemedText>
          <Pressable
            onPress={() => setShowUpgradeModal(true)}
            style={[styles.upgradeButton, { backgroundColor: theme.link }]}
            accessibilityRole="button"
            accessibilityLabel="Upgrade to premium"
          >
            <ThemedText
              style={[styles.upgradeButtonText, { color: theme.buttonText }]}
            >
              Upgrade
            </ThemedText>
          </Pressable>
        </View>
        <UpgradeModal
          visible={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
        />
      </View>
    );
  }

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

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <SwipeableRow
            rightAction={{
              icon: "trash-2",
              label: "Delete",
              backgroundColor: theme.error,
              onAction: () => handleDelete(item.id),
            }}
          >
            <PantryItemRow item={item} onDelete={handleDelete} />
          </SwipeableRow>
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
          paddingBottom: insets.bottom + Spacing.xl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch().then(() => haptics.impact())}
            progressViewOffset={headerHeight}
            tintColor={theme.link}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <View style={styles.listHeaderTop}>
              <ThemedText style={styles.listTitle}>Your Pantry</ThemedText>
              {features.receiptScanner && (
                <Pressable
                  onPress={() => {
                    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
                    navigation.navigate("ReceiptCapture");
                  }}
                  style={[
                    styles.receiptButton,
                    { backgroundColor: withOpacity(theme.link, 0.1) },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Scan receipt to add items"
                >
                  <Feather name="camera" size={16} color={theme.link} />
                  <ThemedText
                    style={[styles.receiptButtonText, { color: theme.link }]}
                  >
                    Scan Receipt
                  </ThemedText>
                </Pressable>
              )}
            </View>
            <ThemedText
              style={[styles.itemCountText, { color: theme.textSecondary }]}
            >
              {pantryItems?.length || 0} items
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather
              name="package"
              size={48}
              color={withOpacity(theme.text, 0.2)}
            />
            <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
              Pantry is Empty
            </ThemedText>
            <ThemedText
              style={[styles.emptySubtitle, { color: theme.textSecondary }]}
            >
              Add items below to track what you have at home.
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
              placeholder="Add pantry item..."
              placeholderTextColor={theme.textSecondary}
              returnKeyType="done"
              onSubmitEditing={handleAddItem}
              accessibilityLabel="Add pantry item"
            />
            <Pressable
              onPress={handleAddItem}
              disabled={!newItemName.trim() || createMutation.isPending}
              style={[
                styles.addButton,
                {
                  backgroundColor: theme.link,
                  opacity:
                    !newItemName.trim() || createMutation.isPending ? 0.4 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add item to pantry"
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
  listHeader: {
    marginBottom: Spacing.lg,
  },
  listHeaderTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listTitle: {
    fontSize: 20,
    fontFamily: FontFamily.bold,
    marginBottom: Spacing.xs,
  },
  receiptButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
  },
  receiptButtonText: {
    fontSize: 13,
    fontWeight: "600",
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
  expiryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  expiryBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.bold,
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
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  upgradeButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  upgradeButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
});
