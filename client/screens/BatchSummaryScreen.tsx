import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  AccessibilityInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useBatchScan } from "@/context/BatchScanContext";
import { useBatchConfirm } from "@/hooks/useBatchConfirm";
import { SwipeableRow } from "@/components/SwipeableRow";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { withOpacity, Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type {
  BatchItem,
  BatchDestination,
  ResolvedBatchItem,
} from "@shared/types/batch-scan";

type BatchSummaryNavProp = NativeStackNavigationProp<
  RootStackParamList,
  "BatchSummary"
>;

const DESTINATIONS: {
  key: BatchDestination;
  label: string;
  shortLabel: string;
  icon: string;
}[] = [
  {
    key: "daily_log",
    label: "Log to Daily Intake",
    shortLabel: "Daily Intake",
    icon: "plus-circle",
  },
  {
    key: "pantry",
    label: "Add to Pantry",
    shortLabel: "Pantry",
    icon: "package",
  },
  {
    key: "grocery_list",
    label: "Add to Grocery List",
    shortLabel: "Grocery List",
    icon: "shopping-cart",
  },
];

function getDestinationLabel(key: BatchDestination): string {
  return DESTINATIONS.find((d) => d.key === key)!.shortLabel;
}

export default function BatchSummaryScreen() {
  const navigation = useNavigation<BatchSummaryNavProp>();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const {
    getItems,
    pendingCount,
    itemCount,
    removeItem,
    retryItem,
    updateItemQuantity,
    clearSession,
    isSaving,
    setSaving,
  } = useBatchScan();
  const batchConfirm = useBatchConfirm();

  const [items, setItems] = useState<BatchItem[]>([]);
  const [destination, setDestination] = useState<BatchDestination>("daily_log");

  // Load items from ref on mount and on count changes
  useEffect(() => {
    setItems(getItems());
  }, [getItems, itemCount, pendingCount]);

  // Totals (only resolved items)
  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        if (item.status === "resolved") {
          acc.calories += item.calories * item.quantity;
          acc.protein += item.protein * item.quantity;
          acc.carbs += item.carbs * item.quantity;
          acc.fat += item.fat * item.quantity;
        }
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
  }, [items]);

  const unverifiedCount = items.filter((i) => i.status === "error").length;
  const resolvedItems = items.filter(
    (i): i is ResolvedBatchItem => i.status === "resolved",
  );
  const canConfirm =
    resolvedItems.length > 0 && pendingCount === 0 && !isSaving;

  // Back gesture interception
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (isSaving) {
        e.preventDefault();
        return;
      }
      if (items.length === 0) return;

      e.preventDefault();
      Alert.alert(
        "Discard scanned items?",
        `You have ${items.length} item${items.length !== 1 ? "s" : ""}. Discard?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              clearSession();
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, items.length, isSaving, clearSession]);

  const handleRemove = useCallback(
    (id: string) => {
      removeItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [removeItem],
  );

  const handleRetry = useCallback(
    (id: string) => {
      retryItem(id);
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, status: "pending" as const } : i,
        ),
      );
    },
    [retryItem],
  );

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return;

    setSaving(true);
    try {
      await batchConfirm.mutateAsync({
        items: resolvedItems,
        destination,
      });

      const count = resolvedItems.length;
      const destLabel = getDestinationLabel(destination);
      AccessibilityInfo.announceForAccessibility(
        `${count} item${count !== 1 ? "s" : ""} saved to ${destLabel}`,
      );

      clearSession();
      navigation.popToTop();
    } catch {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error("Could not save items. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    canConfirm,
    setSaving,
    batchConfirm,
    resolvedItems,
    destination,
    clearSession,
    navigation,
    haptics,
    toast,
  ]);

  const handleQuantityChange = useCallback(
    (id: string, quantity: number) => {
      updateItemQuantity(id, quantity);
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, quantity: Math.max(1, Math.min(99, quantity)) }
            : i,
        ),
      );
    },
    [updateItemQuantity],
  );

  const renderItem = useCallback(
    ({ item }: { item: BatchItem }) => (
      <BatchItemRow
        item={item}
        theme={theme}
        onRemove={handleRemove}
        onRetry={handleRetry}
        onQuantityChange={handleQuantityChange}
      />
    ),
    [theme, handleRemove, handleRetry, handleQuantityChange],
  );

  const keyExtractor = useCallback((item: BatchItem) => item.id, []);

  if (items.length === 0) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.backgroundRoot,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <Text
          style={[styles.emptyText, { color: theme.textSecondary }]}
          accessibilityLabel="No items. Go back to scan more."
        >
          No items scanned. Go back to scan some barcodes.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundRoot, paddingBottom: insets.bottom },
      ]}
    >
      {/* Header info */}
      {unverifiedCount > 0 && (
        <View
          style={[
            styles.badge,
            { backgroundColor: withOpacity(theme.warning, 0.15) },
          ]}
        >
          <Feather name="alert-circle" size={14} color={theme.warning} />
          <Text style={[styles.badgeText, { color: theme.warning }]}>
            {unverifiedCount} item{unverifiedCount !== 1 ? "s" : ""} failed to
            load
          </Text>
        </View>
      )}

      {/* Items list */}
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        style={styles.list}
      />

      {/* Totals bar */}
      <View
        style={[styles.totalsBar, { borderTopColor: theme.border }]}
        accessible
        accessibilityLabel={`Total: ${Math.round(totals.calories)} calories, ${Math.round(totals.protein)}g protein, ${Math.round(totals.carbs)}g carbs, ${Math.round(totals.fat)}g fat`}
      >
        <Text style={[styles.totalLabel, { color: theme.textSecondary }]}>
          Total
        </Text>
        <View style={styles.totalPills}>
          <NutrientPill
            label="Cal"
            value={Math.round(totals.calories)}
            theme={theme}
          />
          <NutrientPill
            label="P"
            value={Math.round(totals.protein)}
            theme={theme}
          />
          <NutrientPill
            label="C"
            value={Math.round(totals.carbs)}
            theme={theme}
          />
          <NutrientPill
            label="F"
            value={Math.round(totals.fat)}
            theme={theme}
          />
        </View>
      </View>

      {/* Destination selector */}
      <View
        style={styles.destinationSection}
        accessibilityRole="radiogroup"
        accessibilityLabel="Save destination"
      >
        {DESTINATIONS.map((dest) => (
          <Pressable
            key={dest.key}
            onPress={() => setDestination(dest.key)}
            style={[
              styles.destinationOption,
              {
                backgroundColor:
                  destination === dest.key
                    ? withOpacity(theme.link, 0.12)
                    : theme.backgroundDefault,
                borderColor:
                  destination === dest.key ? theme.link : theme.border,
              },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ checked: destination === dest.key }}
            accessibilityLabel={dest.label}
          >
            <Feather
              name={dest.icon as keyof typeof Feather.glyphMap}
              size={18}
              color={
                destination === dest.key ? theme.link : theme.textSecondary
              }
            />
            <Text
              style={[
                styles.destinationText,
                {
                  color: destination === dest.key ? theme.link : theme.text,
                },
              ]}
            >
              {dest.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Confirm button */}
      <Pressable
        onPress={handleConfirm}
        disabled={!canConfirm}
        style={[
          styles.confirmButton,
          {
            backgroundColor: canConfirm ? theme.link : theme.border,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          pendingCount > 0
            ? `Waiting for ${pendingCount} item${pendingCount !== 1 ? "s" : ""} to load`
            : `Add ${resolvedItems.length} item${resolvedItems.length !== 1 ? "s" : ""} to ${getDestinationLabel(destination)}`
        }
        accessibilityState={{ disabled: !canConfirm, busy: isSaving }}
      >
        {isSaving ? (
          <ActivityIndicator color={theme.buttonText} size="small" />
        ) : (
          <Text style={[styles.confirmText, { color: theme.buttonText }]}>
            {pendingCount > 0
              ? `Waiting for ${pendingCount} item${pendingCount !== 1 ? "s" : ""}...`
              : `Add ${resolvedItems.length} item${resolvedItems.length !== 1 ? "s" : ""} to ${getDestinationLabel(destination)}`}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const BatchItemRow = React.memo(function BatchItemRow({
  item,
  theme,
  onRemove,
  onRetry,
  onQuantityChange,
}: {
  item: BatchItem;
  theme: ReturnType<typeof useTheme>["theme"];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onQuantityChange: (id: string, quantity: number) => void;
}) {
  const accessibilityActions = useMemo(() => {
    const actions = [{ name: "delete", label: "Delete item" }];
    if (item.status === "error") {
      actions.push({ name: "retry", label: "Retry lookup" });
    }
    return actions;
  }, [item.status]);

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "delete") {
        onRemove(item.id);
      } else if (event.nativeEvent.actionName === "retry") {
        onRetry(item.id);
      }
    },
    [item.id, onRemove, onRetry],
  );

  const rowLabel = useMemo(() => {
    if (item.status === "resolved") {
      return `${item.productName}, ${Math.round(item.calories)} calories, quantity ${item.quantity}`;
    }
    if (item.status === "pending") {
      return `${item.productName}, loading nutrition data`;
    }
    return `${item.productName}, failed to load`;
  }, [item]);

  return (
    <SwipeableRow
      rightAction={{
        icon: "trash-2",
        label: "Delete",
        backgroundColor: theme.error,
        onAction: () => onRemove(item.id),
      }}
    >
      <View
        style={[styles.row, { backgroundColor: theme.backgroundDefault }]}
        accessible
        accessibilityLabel={rowLabel}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={handleAccessibilityAction}
      >
        <View style={styles.rowContent}>
          <View style={styles.rowHeader}>
            <Text
              style={[styles.productName, { color: theme.text }]}
              numberOfLines={1}
            >
              {item.productName}
            </Text>
            <View style={styles.quantityStepper}>
              <Pressable
                onPress={() => onQuantityChange(item.id, item.quantity - 1)}
                disabled={item.quantity <= 1}
                accessibilityRole="button"
                accessibilityLabel={`Decrease quantity, currently ${item.quantity}`}
                hitSlop={8}
                style={[
                  styles.stepperButton,
                  {
                    borderColor: theme.border,
                    opacity: item.quantity <= 1 ? 0.3 : 1,
                  },
                ]}
              >
                <Feather name="minus" size={14} color={theme.text} />
              </Pressable>
              <Text
                style={[styles.quantityText, { color: theme.text }]}
                accessibilityLabel={`Quantity ${item.quantity}`}
              >
                {item.quantity}
              </Text>
              <Pressable
                onPress={() => onQuantityChange(item.id, item.quantity + 1)}
                disabled={item.quantity >= 99}
                accessibilityRole="button"
                accessibilityLabel={`Increase quantity, currently ${item.quantity}`}
                hitSlop={8}
                style={[
                  styles.stepperButton,
                  {
                    borderColor: theme.border,
                    opacity: item.quantity >= 99 ? 0.3 : 1,
                  },
                ]}
              >
                <Feather name="plus" size={14} color={theme.text} />
              </Pressable>
            </View>
          </View>
          {item.brandName && (
            <Text
              style={[styles.brandName, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {item.brandName}
            </Text>
          )}

          {/* Status-specific content */}
          {item.status === "resolved" && (
            <View style={styles.nutrientRow}>
              <NutrientPill
                label="Cal"
                value={Math.round(item.calories)}
                theme={theme}
              />
              <NutrientPill
                label="P"
                value={Math.round(item.protein)}
                theme={theme}
              />
              <NutrientPill
                label="C"
                value={Math.round(item.carbs)}
                theme={theme}
              />
              <NutrientPill
                label="F"
                value={Math.round(item.fat)}
                theme={theme}
              />
            </View>
          )}
          {item.status === "pending" && (
            <ActivityIndicator
              size="small"
              color={theme.link}
              style={styles.statusIndicator}
            />
          )}
          {item.status === "error" && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={14} color={theme.error} />
              <Text style={[styles.errorText, { color: theme.error }]}>
                Failed
              </Text>
              <Pressable
                onPress={() => onRetry(item.id)}
                accessibilityRole="button"
                accessibilityLabel="Retry nutrition lookup"
                hitSlop={8}
              >
                <Text style={[styles.retryText, { color: theme.link }]}>
                  Retry
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </SwipeableRow>
  );
});

function NutrientPill({
  label,
  value,
  theme,
}: {
  label: string;
  value: number;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: withOpacity(theme.textSecondary, 0.1) },
      ]}
    >
      <Text style={[styles.pillValue, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.pillLabel, { color: theme.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 200,
    marginHorizontal: Spacing.xl,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "500",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: Spacing.sm,
  },
  row: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  rowContent: {
    gap: 2,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  productName: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  quantityStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  stepperButton: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  quantityText: {
    fontSize: 14,
    fontWeight: "600",
    minWidth: 20,
    textAlign: "center",
  },
  brandName: {
    fontSize: 13,
  },
  nutrientRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  statusIndicator: {
    marginTop: Spacing.xs,
    alignSelf: "flex-start",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  errorText: {
    fontSize: 13,
  },
  retryText: {
    fontSize: 13,
    fontWeight: "600",
    marginLeft: Spacing.sm,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  pillValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  pillLabel: {
    fontSize: 11,
  },
  totalsBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  totalPills: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  destinationSection: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  destinationOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  destinationText: {
    fontSize: 14,
    fontWeight: "500",
  },
  confirmButton: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
