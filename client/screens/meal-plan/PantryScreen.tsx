import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  Pressable,
  SectionList,
  TextInput,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { SwipeableRow } from "@/components/SwipeableRow";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { IngredientIcon } from "@/components/IngredientIcon";
import { EmptyState } from "@/components/EmptyState";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { useToast } from "@/context/ToastContext";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import {
  usePantryItems,
  useCreatePantryItem,
  useDeletePantryItem,
} from "@/hooks/usePantry";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { PantryItem } from "@shared/schema";
import { useFromHomeBackRedirect } from "@/hooks/useFromHomeBackRedirect";

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
      <IngredientIcon
        name={item.name}
        category={item.category ?? undefined}
        size={28}
      />
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
  const headerHeight = useHeaderContentInset();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { features } = usePremiumContext();
  const { confirm, ConfirmationModal, behindContentA11yProps, isOpen } =
    useConfirmationModal();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MealPlanStackParamList, "Pantry">>();
  useFromHomeBackRedirect(navigation, route.params?.fromHome);

  // The navigator renders the header as a sibling `behindContentA11yProps`
  // can't reach — hide its back/close control while the sheet is presented
  // so TalkBack/VoiceOver can't swipe past the sheet to it (see
  // todos/archive/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md).
  // This screen is dual-mounted: `MealPlanStackNavigator` gives it the
  // native default back button (route "Pantry", no static `headerLeft`),
  // while `RootStackNavigator` mounts it as "PantryModal" with a custom
  // close "X" `headerLeft`. `setOptions` merges by spreading onto prior
  // override state (verified against @react-navigation/core's
  // useNavigationCache.js), so restoring via `headerLeft: undefined` would
  // PERMANENTLY replace that custom close button with the native default
  // arrow, not fall back to it — the `headerLeft` override branch below
  // re-renders the same Pressable instead. Gating the safer
  // `headerBackVisible` toggle on the known MealPlanStack route name (rather
  // than gating the `headerLeft` override on "PantryModal") means a
  // renamed/unexpected RootStack route name still gets a real header
  // override instead of silently falling through.
  // This copy is not merely a duplicate of RootStackNavigator.tsx's inline
  // `headerLeft` — once this effect runs (from mount, since `isOpen` starts
  // false), it PERMANENTLY shadows the navigator's static definition for the
  // route's lifetime, so a future edit to the navigator's close button won't
  // reach this route; keep the two in sync by hand.
  // `headerLeft: () => null` alone is NOT sufficient to hide the native back
  // control on Android here: react-native-screens only computes
  // `hideBackButton` from `headerBackVisible`, and separately derives
  // `backButtonInCustomView` as true whenever `headerTitle` is a function AND
  // `headerLeft` renders null (both true on this route while `isOpen`) —
  // which skips the one statement that would otherwise null the toolbar's
  // navigation icon. `headerBackVisible: false` must be set alongside
  // `headerLeft` in this branch too, not just in the sibling branch above.
  // It must NOT be set to `true` (e.g. via a plain `!isOpen`) in the closed
  // state: `backButtonInCustomView` is `headerBackVisible || (…)`, so an
  // explicit `true` short-circuits it to `true` unconditionally, which skips
  // the native-icon-nulling branch and leaves the native back arrow visible
  // alongside this custom close "X" whenever the sheet is closed (the
  // default, common state) — a duplicate-control regression, not a fix.
  // `undefined` (not the key omitted) is safe here precisely because
  // `headerBackVisible` has no static value on this route for a dynamic
  // `undefined` to permanently shadow (unlike `headerLeft` above) — both
  // native reads of it test `=== false` / truthiness, so `undefined`
  // reproduces "never set" exactly.
  useEffect(() => {
    if (route.name === "Pantry") {
      navigation.setOptions({ headerBackVisible: !isOpen });
    } else {
      navigation.setOptions({
        headerBackVisible: isOpen ? false : undefined,
        headerLeft: isOpen
          ? () => null
          : () => (
              <Pressable
                onPress={() => navigation.goBack()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            ),
      });
    }
  }, [isOpen, navigation, route.name, theme.text]);

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const addItemInputRef = useRef<TextInput>(null);

  const {
    data: pantryItems,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = usePantryItems();
  const createMutation = useCreatePantryItem();
  const deleteMutation = useDeletePantryItem();

  const handleAddItem = useCallback(() => {
    const name = newItemName.trim();
    if (!name) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    createMutation.mutate(
      { name },
      {
        onSuccess: () => setNewItemName(""),
        onError: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          toast.error("Couldn't add the item. Please try again.");
        },
      },
    );
  }, [haptics, toast, createMutation, newItemName]);

  const handleDeleteItem = useCallback(
    (id: number) => {
      deleteMutation.mutate(id, {
        onError: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          toast.error("Couldn't remove the item. Please try again.");
        },
      });
    },
    [haptics, toast, deleteMutation],
  );

  const handleDelete = useCallback(
    (id: number) => {
      confirm({
        title: "Remove Item",
        message: "Remove this item from your pantry?",
        confirmLabel: "Remove",
        destructive: true,
        onConfirm: () => handleDeleteItem(id),
      });
    },
    [confirm, handleDeleteItem],
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
        accessibilityViewIsModal
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
            style={[
              styles.upgradeButton,
              { backgroundColor: theme.accentSolid },
            ]}
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
        accessibilityViewIsModal
      >
        <SkeletonProvider>
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
        </SkeletonProvider>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      accessibilityViewIsModal
    >
      <SectionList
        {...FLATLIST_DEFAULTS}
        {...behindContentA11yProps}
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
            leftAction={{
              icon: "check",
              label: "Used",
              backgroundColor: theme.success,
              onAction: () => {
                haptics.impact(Haptics.ImpactFeedbackStyle.Light);
                handleDeleteItem(item.id);
              },
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
            <View style={styles.sectionHeaderContent}>
              <IngredientIcon
                name={section.title}
                category={section.title.toLowerCase()}
                size={20}
              />
              <ThemedText style={styles.sectionTitle}>
                {section.title}
              </ThemedText>
            </View>
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
          isError ? (
            <EmptyState
              variant="temporary"
              icon="alert-circle"
              title="Couldn't load your pantry"
              description="Something went wrong loading your items. Pull down to refresh or tap below to try again."
              actionLabel="Try Again"
              onAction={() => {
                void refetch();
              }}
            />
          ) : (
            <EmptyState
              variant="firstTime"
              icon="camera"
              title="Your pantry is empty"
              description="Scan a grocery receipt and we'll add every item to your pantry automatically."
              actionLabel="Scan a Receipt"
              onAction={() => navigation.navigate("ReceiptCapture")}
              secondaryLabel="or add items manually"
              onSecondaryAction={() => addItemInputRef.current?.focus()}
            />
          )
        }
        ListFooterComponent={
          <View style={styles.addItemRow}>
            <TextInput
              ref={addItemInputRef}
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
                  backgroundColor: theme.accentSolid,
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
      <ConfirmationModal />
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
  sectionHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
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
