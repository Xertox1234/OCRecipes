import React, { useCallback, useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Modal,
  Pressable,
  FlatList,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  useGroceryLists,
  useCreateGroceryList,
  useAddManualGroceryItem,
} from "@/hooks/useGroceryList";
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
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const { data: lists, isLoading } = useGroceryLists();
  const createList = useCreateGroceryList();
  const addItem = useAddManualGroceryItem();

  const [showNewListInput, setShowNewListInput] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  const [addingToListId, setAddingToListId] = useState<number | null>(null);

  const isAdding = addItem.isPending;

  // Reset local state when modal is dismissed
  useEffect(() => {
    if (!visible) {
      setShowNewListInput(false);
      setNewListTitle("");
      setAddingToListId(null);
    }
  }, [visible]);

  const handleAddToList = useCallback(
    (listId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setAddingToListId(listId);
      addItem.mutate(
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
    [haptics, addItem, itemName, onClose],
  );

  const handleCreateAndAdd = useCallback(() => {
    const title = newListTitle.trim() || "Grocery List";
    const today = new Date().toISOString().split("T")[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    createList.mutate(
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
  }, [haptics, createList, newListTitle, handleAddToList]);

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
            styles.listItem,
            { backgroundColor: withOpacity(theme.text, 0.04) },
            pressed && { opacity: 0.7 },
            isAdding && !isThisAdding && { opacity: 0.4 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Add to ${item.title}`}
        >
          <View style={styles.listItemContent}>
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

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[
          styles.container,
          {
            backgroundColor: theme.backgroundRoot,
            paddingBottom: Math.max(insets.bottom, Spacing.xl) + Spacing.md,
          },
        ]}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <View style={styles.headerTextGroup}>
            <ThemedText style={styles.headerTitle}>
              Add to Grocery List
            </ThemedText>
            <ThemedText
              style={[styles.headerSubtitle, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {itemName}
            </ThemedText>
          </View>
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        </View>

        {/* List of grocery lists */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.success} />
          </View>
        ) : (
          <FlatList
            data={lists || []}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderListItem}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Feather
                  name="shopping-cart"
                  size={40}
                  color={withOpacity(theme.text, 0.2)}
                />
                <ThemedText
                  style={[styles.emptyText, { color: theme.textSecondary }]}
                >
                  No grocery lists yet. Create one to get started.
                </ThemedText>
              </View>
            }
          />
        )}

        {/* New list input */}
        {showNewListInput ? (
          <View
            style={[styles.newListInputRow, { borderTopColor: theme.border }]}
          >
            <TextInput
              style={[
                styles.newListInput,
                {
                  color: theme.text,
                  borderColor: withOpacity(theme.text, 0.15),
                  backgroundColor: withOpacity(theme.text, 0.04),
                },
              ]}
              value={newListTitle}
              onChangeText={setNewListTitle}
              placeholder="List name (optional)"
              placeholderTextColor={theme.textSecondary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateAndAdd}
              accessibilityLabel="New grocery list name"
            />
            <Pressable
              onPress={handleCreateAndAdd}
              disabled={createList.isPending}
              style={[
                styles.createButton,
                {
                  backgroundColor: theme.success,
                  opacity: createList.isPending ? 0.6 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Create list and add item"
            >
              {createList.isPending ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <ThemedText style={{ color: theme.buttonText }}>
                  Create
                </ThemedText>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Pressable
              onPress={() => {
                haptics.impact(Haptics.ImpactFeedbackStyle.Light);
                setShowNewListInput(true);
              }}
              style={[styles.newListButton, { borderColor: theme.success }]}
              accessibilityRole="button"
              accessibilityLabel="Create new grocery list"
            >
              <Feather name="plus" size={18} color={theme.success} />
              <ThemedText
                style={[styles.newListButtonText, { color: theme.success }]}
              >
                New List
              </ThemedText>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTextGroup: {
    flex: 1,
    marginRight: Spacing.md,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    padding: Spacing.lg,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.sm,
  },
  listItemContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: Spacing.sm,
  },
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
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  newListButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    gap: Spacing.sm,
  },
  newListButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  newListInputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  newListInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 14,
  },
  createButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.full,
    minWidth: 80,
    alignItems: "center",
  },
});
