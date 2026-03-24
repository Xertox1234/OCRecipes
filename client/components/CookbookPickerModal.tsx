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
  useCookbooks,
  useCreateCookbook,
  useAddRecipeToCookbook,
} from "@/hooks/useCookbooks";
import type { CookbookWithCount } from "@shared/schema";

interface CookbookPickerModalProps {
  visible: boolean;
  onClose: () => void;
  recipeId: number;
  recipeType: "mealPlan" | "community";
}

export function CookbookPickerModal({
  visible,
  onClose,
  recipeId,
  recipeType,
}: CookbookPickerModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const { data: cookbooks, isLoading } = useCookbooks();
  const { mutate: createCookbookMutate, isPending: isCreating } =
    useCreateCookbook();
  const { mutate: addRecipeMutate, isPending: isAdding } =
    useAddRecipeToCookbook();

  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState("");
  const [addingToId, setAddingToId] = useState<number | null>(null);

  // Reset local state when modal is dismissed
  useEffect(() => {
    if (!visible) {
      setShowNewInput(false);
      setNewName("");
      setAddingToId(null);
    }
  }, [visible]);

  const handleAddToCookbook = useCallback(
    (cookbookId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setAddingToId(cookbookId);
      addRecipeMutate(
        { cookbookId, recipeId, recipeType },
        {
          onSuccess: () => {
            haptics.notification(Haptics.NotificationFeedbackType.Success);
            setAddingToId(null);
            onClose();
          },
          onError: (err) => {
            setAddingToId(null);
            if (err.message === "Recipe already in cookbook") {
              haptics.notification(Haptics.NotificationFeedbackType.Warning);
              Alert.alert(
                "Already Saved",
                "This recipe is already in that cookbook.",
              );
            } else {
              haptics.notification(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Error", "Failed to add recipe. Please try again.");
            }
          },
        },
      );
    },
    [haptics, addRecipeMutate, recipeId, recipeType, onClose],
  );

  const handleCreateAndAdd = useCallback(() => {
    const name = newName.trim() || "My Cookbook";
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    createCookbookMutate(
      { name },
      {
        onSuccess: (cookbook) => {
          setShowNewInput(false);
          setNewName("");
          handleAddToCookbook(cookbook.id);
        },
        onError: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          Alert.alert("Error", "Failed to create cookbook. Please try again.");
        },
      },
    );
  }, [haptics, createCookbookMutate, newName, handleAddToCookbook]);

  const handleClose = useCallback(() => {
    setAddingToId(null);
    onClose();
  }, [onClose]);

  const renderItem = useCallback(
    ({ item }: { item: CookbookWithCount }) => {
      const isThisAdding = addingToId === item.id;
      return (
        <Pressable
          onPress={() => handleAddToCookbook(item.id)}
          disabled={isAdding}
          style={({ pressed }) => [
            styles.listItem,
            { backgroundColor: withOpacity(theme.text, 0.04) },
            pressed && { opacity: 0.7 },
            isAdding && !isThisAdding && { opacity: 0.4 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Save to ${item.name}`}
        >
          <View style={styles.listItemContent}>
            <Feather
              name="book"
              size={18}
              color={theme.link}
              style={{ marginRight: Spacing.md }}
            />
            <View style={styles.listItemText}>
              <ThemedText style={styles.listItemTitle} numberOfLines={1}>
                {item.name}
              </ThemedText>
              <ThemedText
                style={[styles.listItemCount, { color: theme.textSecondary }]}
              >
                {item.recipeCount}{" "}
                {item.recipeCount === 1 ? "recipe" : "recipes"}
              </ThemedText>
            </View>
          </View>
          {isThisAdding ? (
            <ActivityIndicator size="small" color={theme.link} />
          ) : (
            <Feather name="plus" size={18} color={theme.textSecondary} />
          )}
        </Pressable>
      );
    },
    [theme, handleAddToCookbook, isAdding, addingToId],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        accessibilityViewIsModal
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
          <ThemedText style={styles.headerTitle}>Save to Cookbook</ThemedText>
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        </View>

        {/* List of cookbooks */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.link} />
          </View>
        ) : (
          <FlatList
            data={cookbooks || []}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Feather
                  name="book"
                  size={40}
                  color={withOpacity(theme.text, 0.2)}
                />
                <ThemedText
                  style={[styles.emptyText, { color: theme.textSecondary }]}
                >
                  No cookbooks yet. Create one to save this recipe.
                </ThemedText>
              </View>
            }
          />
        )}

        {/* Footer: New cookbook input or button */}
        {showNewInput ? (
          <View style={[styles.newInputRow, { borderTopColor: theme.border }]}>
            <TextInput
              style={[
                styles.newInput,
                {
                  color: theme.text,
                  borderColor: withOpacity(theme.text, 0.15),
                  backgroundColor: withOpacity(theme.text, 0.04),
                },
              ]}
              value={newName}
              onChangeText={setNewName}
              placeholder="Cookbook name (optional)"
              placeholderTextColor={theme.textSecondary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateAndAdd}
              accessibilityLabel="New cookbook name"
            />
            <Pressable
              onPress={handleCreateAndAdd}
              disabled={isCreating}
              style={[
                styles.createButton,
                {
                  backgroundColor: theme.link,
                  opacity: isCreating ? 0.6 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Create cookbook and save recipe"
            >
              {isCreating ? (
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
                setShowNewInput(true);
              }}
              style={[styles.newButton, { borderColor: theme.link }]}
              accessibilityRole="button"
              accessibilityLabel="Create new cookbook"
            >
              <Feather name="plus" size={18} color={theme.link} />
              <ThemedText style={[styles.newButtonText, { color: theme.link }]}>
                New Cookbook
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
  headerTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
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
  listItemText: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  listItemCount: {
    fontSize: 12,
    marginTop: 1,
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
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    gap: Spacing.sm,
  },
  newButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  newInputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  newInput: {
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
