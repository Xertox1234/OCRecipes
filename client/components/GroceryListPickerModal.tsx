import React, { useCallback, useState } from "react";
import { toLocalDateString } from "@shared/lib/date";
import {
  StyleSheet,
  View,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import {
  PickerCreateFooter,
  PickerSheet,
  pickerRowStyles,
} from "@/components/PickerSheet";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, FontFamily, withOpacity } from "@/constants/theme";
import {
  useGroceryLists,
  useCreateGroceryList,
  useAddManualGroceryItem,
} from "@/hooks/useGroceryList";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import type { GroceryList } from "@shared/schema";

interface GroceryListPickerModalProps {
  visible: boolean;
  onClose: () => void;
  itemName: string;
}

export function GroceryListPickerModal({
  visible,
  onClose,
  itemName,
}: GroceryListPickerModalProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { data: lists, isLoading, isError } = useGroceryLists();
  // Both mutations' onError below already shows an Alert — opt out so the
  // global net doesn't double it.
  const { mutate: createListMutate, isPending: isCreating } =
    useCreateGroceryList({ silentError: true });
  const { mutate: addItemMutate, isPending: isAdding } =
    useAddManualGroceryItem({ silentError: true });

  const [showNewListInput, setShowNewListInput] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  const [addingToListId, setAddingToListId] = useState<number | null>(null);

  // Reset local state when modal is dismissed (set during render when
  // `visible` changes — React's "adjust state when a prop changes" pattern)
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (!visible) {
      setShowNewListInput(false);
      setNewListTitle("");
      setAddingToListId(null);
    }
  }

  const handleAddToList = useCallback(
    (listId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setAddingToListId(listId);
      addItemMutate(
        { listId, name: itemName, category: "food" },
        {
          onSuccess: () => {
            haptics.notification(Haptics.NotificationFeedbackType.Success);
            setAddingToListId(null);
            onClose();
          },
          onError: () => {
            haptics.notification(Haptics.NotificationFeedbackType.Error);
            setAddingToListId(null);
            Alert.alert(
              "Error",
              "Failed to add item to list. Please try again.",
            );
          },
        },
      );
    },
    [haptics, addItemMutate, itemName, onClose],
  );

  const handleCreateAndAdd = useCallback(() => {
    const title = newListTitle.trim() || "Grocery List";
    const now = new Date();
    const today = toLocalDateString(now);
    const nextWeekDate = new Date(now);
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    const nextWeek = toLocalDateString(nextWeekDate);

    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    createListMutate(
      { startDate: today, endDate: nextWeek, title },
      {
        onSuccess: (list) => {
          setShowNewListInput(false);
          setNewListTitle("");
          handleAddToList(list.id);
        },
        onError: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          Alert.alert("Error", "Failed to create list. Please try again.");
        },
      },
    );
  }, [haptics, createListMutate, newListTitle, handleAddToList]);

  const handleClose = useCallback(() => {
    setShowNewListInput(false);
    setNewListTitle("");
    setAddingToListId(null);
    onClose();
  }, [onClose]);

  const renderListItem = useCallback(
    ({ item }: { item: GroceryList }) => {
      const isThisAdding = addingToListId === item.id;
      return (
        <Pressable
          onPress={() => handleAddToList(item.id)}
          disabled={isAdding}
          style={({ pressed }) => [
            pickerRowStyles.listItem,
            { backgroundColor: withOpacity(theme.text, 0.04) },
            pressed && { opacity: 0.7 },
            isAdding && !isThisAdding && { opacity: 0.4 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Add to ${item.title}`}
        >
          <View style={pickerRowStyles.listItemContent}>
            <Feather
              name="shopping-cart"
              size={18}
              color={theme.success}
              style={{ marginRight: Spacing.md }}
            />
            <ThemedText style={styles.listItemTitle} numberOfLines={1}>
              {item.title}
            </ThemedText>
          </View>
          {isThisAdding ? (
            <ActivityIndicator size="small" color={theme.success} />
          ) : (
            <Feather name="plus" size={18} color={theme.textSecondary} />
          )}
        </Pressable>
      );
    },
    [theme, handleAddToList, isAdding, addingToListId],
  );

  const handleShowNewListInput = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    setShowNewListInput(true);
  }, [haptics]);

  return (
    <PickerSheet
      visible={visible}
      onClose={handleClose}
      title="Add to Grocery List"
      subtitle={itemName}
      isLoading={isLoading}
      accentColor={theme.success}
      footer={
        <PickerCreateFooter
          showInput={showNewListInput}
          onShowInput={handleShowNewListInput}
          showNewButton
          newButtonLabel="New List"
          newButtonAccessibilityLabel="Create new grocery list"
          inputLabel="List name"
          placeholder="Optional, e.g. Weekend shop"
          name={newListTitle}
          onChangeName={setNewListTitle}
          onCreate={handleCreateAndAdd}
          isCreating={isCreating}
          createAccessibilityLabel="Create list and add item"
          accentColor={theme.success}
          fillColor={theme.success}
        />
      }
    >
      <FlatList
        {...FLATLIST_DEFAULTS}
        data={lists || []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderListItem}
        contentContainerStyle={pickerRowStyles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather
              name={isError ? "alert-circle" : "shopping-cart"}
              size={40}
              color={withOpacity(theme.text, 0.2)}
            />
            <ThemedText
              style={[styles.emptyText, { color: theme.textSecondary }]}
            >
              {isError
                ? "Couldn't load your grocery lists. Check your connection, or create a new one below."
                : "No grocery lists yet. Create one to get started."}
            </ThemedText>
          </View>
        }
      />
    </PickerSheet>
  );
}

const styles = StyleSheet.create({
  listItemTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    flex: 1,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    marginTop: Spacing.md,
    lineHeight: 20,
  },
});
