import React, { useCallback, useEffect, useState } from "react";
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
import { EmptyState } from "@/components/EmptyState";
import {
  PickerCreateFooter,
  PickerSheet,
  pickerRowStyles,
} from "@/components/PickerSheet";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, FontFamily, withOpacity } from "@/constants/theme";
import {
  useCookbooks,
  useCreateCookbook,
  useAddRecipeToCookbook,
} from "@/hooks/useCookbooks";
import {
  useIsRecipeFavourited,
  useToggleFavouriteRecipe,
} from "@/hooks/useFavouriteRecipes";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
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
  const haptics = useHaptics();
  const { data: cookbooks, isLoading, isError } = useCookbooks();
  const { mutate: createCookbookMutate, isPending: isCreating } =
    useCreateCookbook();
  const { mutate: addRecipeMutate, isPending: isAdding } =
    useAddRecipeToCookbook();
  const isFavourited = useIsRecipeFavourited(recipeId, recipeType);
  // handleSaveToFavourites' own onError below already shows an Alert for a
  // generic failure — opt out so the global net doesn't double it.
  const { mutate: toggleFavouriteMutate } = useToggleFavouriteRecipe({
    silentError: true,
  });

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
            if (err instanceof ApiError && err.code === ErrorCode.CONFLICT) {
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

  const handleShowNewInput = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    setShowNewInput(true);
  }, [haptics]);

  const handleSaveToFavourites = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    toggleFavouriteMutate(
      { recipeId, recipeType },
      {
        onSuccess: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Success);
          onClose();
        },
        onError: (err) => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          // useToggleFavouriteRecipe already alerts for LIMIT_REACHED itself —
          // avoid showing a second, redundant alert for that case.
          if (
            !(err instanceof ApiError && err.code === ErrorCode.LIMIT_REACHED)
          ) {
            Alert.alert("Error", "Failed to save recipe. Please try again.");
          }
        },
      },
    );
  }, [haptics, toggleFavouriteMutate, recipeId, recipeType, onClose]);

  const renderItem = useCallback(
    ({ item }: { item: CookbookWithCount }) => {
      const isThisAdding = addingToId === item.id;
      return (
        <Pressable
          onPress={() => handleAddToCookbook(item.id)}
          disabled={isAdding}
          style={({ pressed }) => [
            pickerRowStyles.listItem,
            { backgroundColor: withOpacity(theme.text, 0.04) },
            pressed && { opacity: 0.7 },
            isAdding && !isThisAdding && { opacity: 0.4 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Save to ${item.name}`}
          accessibilityState={{ disabled: isAdding && !isThisAdding }}
        >
          <View style={pickerRowStyles.listItemContent}>
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
    <PickerSheet
      visible={visible}
      onClose={handleClose}
      title="Save to Cookbook"
      isLoading={isLoading}
      accentColor={theme.link}
      footer={
        <PickerCreateFooter
          showInput={showNewInput}
          onShowInput={handleShowNewInput}
          showNewButton={!!cookbooks && cookbooks.length > 0}
          newButtonLabel="New Cookbook"
          newButtonAccessibilityLabel="Create new cookbook"
          inputLabel="Cookbook name"
          placeholder="Optional, e.g. Weeknight dinners"
          name={newName}
          onChangeName={setNewName}
          onCreate={handleCreateAndAdd}
          isCreating={isCreating}
          createAccessibilityLabel="Create cookbook and save recipe"
          accentColor={theme.link}
          fillColor={theme.accentSolid}
        />
      }
    >
      <FlatList
        {...FLATLIST_DEFAULTS}
        data={cookbooks || []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={pickerRowStyles.listContent}
        ListEmptyComponent={
          <EmptyState
            variant="firstTime"
            icon={isError ? "alert-circle" : "book"}
            title={
              isError ? "Couldn't load your cookbooks" : "No cookbooks yet"
            }
            description={
              isError
                ? "Check your connection and try again, or save this recipe to your favourites instead."
                : "Create one to organize this recipe, or save it to your favourites for quick access."
            }
            actionLabel={showNewInput ? undefined : "New Cookbook"}
            onAction={showNewInput ? undefined : handleShowNewInput}
            secondaryLabel={
              showNewInput || isFavourited ? undefined : "Save to Favourites"
            }
            onSecondaryAction={
              showNewInput || isFavourited ? undefined : handleSaveToFavourites
            }
          />
        }
      />
    </PickerSheet>
  );
}

const styles = StyleSheet.create({
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
});
