import React, { useCallback, useState } from "react";
import { StyleSheet, View, Pressable, FlatList, TextInput } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeTabBarHeight } from "@/hooks/useSafeTabBarHeight";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { toDateString } from "@shared/lib/date";
import {
  useGroceryLists,
  useCreateGroceryList,
  useDeleteGroceryList,
} from "@/hooks/useGroceryList";
import { usePremiumContext } from "@/context/PremiumContext";
import { VERIFICATION_STREAK_UNLOCK_THRESHOLD } from "@shared/types/premium";
import type { GroceryListsScreenNavigationProp } from "@/types/navigation";
import type { GroceryList } from "@shared/schema";
import { formatDateRange } from "@/lib/format";

export default function GroceryListsScreen() {
  const navigation = useNavigation<GroceryListsScreenNavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { confirm, ConfirmationModal } = useConfirmationModal();
  const { data: lists, isLoading, isError, refetch } = useGroceryLists();
  const { streakUnlocks } = usePremiumContext();
  const { mutate: createListMutate, isPending: isCreatingList } =
    useCreateGroceryList();
  const { mutate: deleteListMutate } = useDeleteGroceryList();

  const extendedRangeUnlockedByStreak =
    streakUnlocks.includes("extendedPlanRange");

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return toDateString(d);
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return toDateString(d);
  });

  const handleGenerate = useCallback(() => {
    haptics.impact();
    createListMutate(
      { startDate, endDate },
      {
        onSuccess: (list) => {
          setShowDatePicker(false);
          navigation.navigate("GroceryList", { listId: list.id });
        },
      },
    );
  }, [haptics, createListMutate, startDate, endDate, navigation]);

  const handleDelete = useCallback(
    (id: number) => {
      confirm({
        title: "Delete List",
        message: "Are you sure you want to delete this list?",
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => deleteListMutate(id),
      });
    },
    [confirm, deleteListMutate],
  );

  const renderItem = useCallback(
    ({ item }: { item: GroceryList }) => (
      <Pressable
        onPress={() => {
          haptics.selection();
          navigation.navigate("GroceryList", { listId: item.id });
        }}
        style={[
          styles.listItem,
          { backgroundColor: withOpacity(theme.text, 0.04) },
        ]}
        accessibilityRole="button"
        accessibilityLabel={item.title}
      >
        <View style={styles.listItemContent}>
          <ThemedText style={styles.listItemTitle} numberOfLines={1}>
            {item.title}
          </ThemedText>
          <ThemedText
            style={[styles.listItemDate, { color: theme.textSecondary }]}
          >
            {formatDateRange(item.dateRangeStart, item.dateRangeEnd)}
          </ThemedText>
        </View>
        <Pressable
          onPress={() => handleDelete(item.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.title}`}
        >
          <Feather name="trash-2" size={16} color={theme.textSecondary} />
        </Pressable>
      </Pressable>
    ),
    [theme, haptics, navigation, handleDelete],
  );

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
            {[1, 2, 3].map((i) => (
              <SkeletonBox
                key={i}
                width="100%"
                height={64}
                borderRadius={12}
                style={{ marginBottom: Spacing.md }}
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
      <FlatList
        {...FLATLIST_DEFAULTS}
        data={lists || []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl + 56,
        }}
        ListEmptyComponent={
          isError ? (
            <View style={styles.emptyState}>
              <Feather
                name="alert-circle"
                size={48}
                color={withOpacity(theme.text, 0.2)}
              />
              <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
                Couldn&apos;t load your lists
              </ThemedText>
              <ThemedText
                style={[styles.emptySubtitle, { color: theme.textSecondary }]}
              >
                Something went wrong. Check your connection and try again.
              </ThemedText>
              <Pressable
                onPress={() => {
                  haptics.impact();
                  void refetch();
                }}
                style={[styles.generateButton, { backgroundColor: theme.link }]}
                accessibilityRole="button"
                accessibilityLabel="Retry loading grocery lists"
              >
                <ThemedText style={{ color: theme.buttonText }}>
                  Try Again
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Feather
                name="shopping-cart"
                size={48}
                color={withOpacity(theme.text, 0.2)}
              />
              <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
                No Grocery Lists
              </ThemedText>
              <ThemedText
                style={[styles.emptySubtitle, { color: theme.textSecondary }]}
              >
                Generate a list from your planned meals.
              </ThemedText>
            </View>
          )
        }
        ListHeaderComponent={
          showDatePicker ? (
            <View
              style={[
                styles.datePickerCard,
                { backgroundColor: withOpacity(theme.text, 0.04) },
              ]}
            >
              <ThemedText style={styles.datePickerLabel}>Date Range</ThemedText>
              {extendedRangeUnlockedByStreak ? (
                <ThemedText
                  style={[styles.streakUnlockNote, { color: theme.success }]}
                >
                  {`Extended meal planning unlocked by your ${VERIFICATION_STREAK_UNLOCK_THRESHOLD}-day verification streak`}
                </ThemedText>
              ) : null}
              <View style={styles.dateInputRow}>
                <TextInput
                  style={[
                    styles.dateInput,
                    {
                      color: theme.text,
                      borderColor: withOpacity(theme.text, 0.15),
                    },
                  ]}
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  maxLength={10}
                  accessibilityLabel="Start date"
                  accessibilityHint="Enter date in YYYY-MM-DD format"
                />
                <ThemedText style={{ color: theme.textSecondary }}>
                  to
                </ThemedText>
                <TextInput
                  style={[
                    styles.dateInput,
                    {
                      color: theme.text,
                      borderColor: withOpacity(theme.text, 0.15),
                    },
                  ]}
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  maxLength={10}
                  accessibilityLabel="End date"
                  accessibilityHint="Enter date in YYYY-MM-DD format"
                />
              </View>
              <View style={styles.datePickerActions}>
                <Pressable
                  onPress={() => setShowDatePicker(false)}
                  style={[styles.cancelButton, { borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <ThemedText style={{ color: theme.textSecondary }}>
                    Cancel
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleGenerate}
                  disabled={isCreatingList}
                  style={[
                    styles.generateButton,
                    {
                      backgroundColor: theme.link,
                      opacity: isCreatingList ? 0.6 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Generate grocery list"
                >
                  <ThemedText style={{ color: theme.buttonText }}>
                    {isCreatingList ? "Generating..." : "Generate"}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : null
        }
      />

      {/* FAB */}
      {!showDatePicker && (
        <Pressable
          onPress={() => {
            haptics.impact();
            setShowDatePicker(true);
          }}
          style={[
            styles.fab,
            { backgroundColor: theme.link, bottom: tabBarHeight + Spacing.md },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Generate new grocery list"
        >
          <Feather name="plus" size={24} color={theme.buttonText} />
        </Pressable>
      )}
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
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.md,
  },
  listItemContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  listItemTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    marginBottom: 2,
  },
  listItemDate: {
    fontSize: 13,
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
  datePickerCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.lg,
  },
  datePickerLabel: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.md,
  },
  streakUnlockNote: {
    fontSize: 13,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  dateInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 14,
  },
  datePickerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  cancelButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  generateButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  fab: {
    position: "absolute",
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000", // hardcoded
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
