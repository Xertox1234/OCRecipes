import React, { useState } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";

import { FocusTextInput } from "@/components/FocusTextInput";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { PreparationPicker } from "@/components/PreparationPicker";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { listStaggerMaxIndex } from "@/constants/animations";
import { FoodCategory } from "@shared/constants/preparation";
import type { FoodItem } from "@/lib/photo-upload";

export function FoodItemCard({
  food,
  index,
  onEdit,
  reducedMotion,
  isSelected,
  onToggleSelect,
  showNutrition,
  showCheckbox,
  prepMethod,
  onPrepChange,
  isPrepLoading,
  showPrepPicker,
}: {
  food: FoodItem;
  index: number;
  onEdit: (index: number, field: "name" | "quantity", value: string) => void;
  reducedMotion: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  showNutrition: boolean;
  showCheckbox: boolean;
  prepMethod?: string;
  onPrepChange?: (method: string) => void;
  isPrepLoading?: boolean;
  showPrepPicker: boolean;
}) {
  const { theme } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(food.name);
  const [editQuantity, setEditQuantity] = useState(food.quantity);

  const handleSave = () => {
    onEdit(index, "name", editName);
    onEdit(index, "quantity", editQuantity);
    setIsEditing(false);
  };

  return (
    <Animated.View
      entering={
        reducedMotion
          ? undefined
          : FadeInUp.delay(Math.min(index, listStaggerMaxIndex) * 100).duration(
              400,
            )
      }
    >
      <Card
        elevation={1}
        style={[styles.foodItemCard, !isSelected && styles.foodItemUnselected]}
      >
        <View style={styles.foodItemHeader}>
          {/* Checkbox (only in log intent) */}
          {showCheckbox && (
            <Pressable
              onPress={onToggleSelect}
              accessibilityLabel={
                isSelected ? `Unselect ${food.name}` : `Select ${food.name}`
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              style={styles.checkboxButton}
              hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
            >
              <Feather
                name={isSelected ? "check-square" : "square"}
                size={22}
                color={isSelected ? theme.success : theme.textSecondary}
              />
            </Pressable>
          )}

          {isEditing ? (
            <View style={styles.editFields}>
              <FocusTextInput
                label="Food"
                style={[
                  styles.editInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={editName}
                onChangeText={setEditName}
                placeholder="e.g. grilled chicken"
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Food name"
              />
              <FocusTextInput
                label="Quantity"
                style={[
                  styles.editInput,
                  styles.quantityInput,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    color: theme.text,
                  },
                ]}
                value={editQuantity}
                onChangeText={setEditQuantity}
                placeholder="e.g. 1 cup or 200 g"
                placeholderTextColor={theme.textSecondary}
              />
            </View>
          ) : (
            <View style={styles.foodItemInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {food.name}
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {food.quantity}
              </ThemedText>
            </View>
          )}
          <Pressable
            onPress={() => (isEditing ? handleSave() : setIsEditing(true))}
            accessibilityLabel={isEditing ? "Save changes" : "Edit food item"}
            accessibilityRole="button"
            style={[
              styles.editButton,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            <Feather
              name={isEditing ? "check" : "edit-2"}
              size={16}
              color={theme.text}
            />
          </Pressable>
        </View>

        {showNutrition && food.nutrition && (
          <View style={[styles.nutritionRow, { borderTopColor: theme.border }]}>
            <View style={styles.nutritionItem}>
              <ThemedText type="h4" style={{ color: theme.calorieAccent }}>
                {Math.round(food.nutrition.calories)}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                cal
              </ThemedText>
            </View>
            <View style={styles.nutritionItem}>
              <ThemedText type="body" style={{ color: theme.proteinAccent }}>
                {Math.round(food.nutrition.protein)}g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                protein
              </ThemedText>
            </View>
            <View style={styles.nutritionItem}>
              <ThemedText type="body" style={{ color: theme.carbsAccent }}>
                {Math.round(food.nutrition.carbs)}g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                carbs
              </ThemedText>
            </View>
            <View style={styles.nutritionItem}>
              <ThemedText type="body" style={{ color: theme.fatAccent }}>
                {Math.round(food.nutrition.fat)}g
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                fat
              </ThemedText>
            </View>
          </View>
        )}

        {food.needsClarification && food.clarificationQuestion && (
          <View
            style={[
              styles.clarificationBanner,
              { backgroundColor: withOpacity(theme.warning, 0.15) },
            ]}
          >
            <Feather name="help-circle" size={14} color={theme.warning} />
            <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
              {food.clarificationQuestion}
            </ThemedText>
          </View>
        )}

        {/* Preparation Picker (log intent only) */}
        {showPrepPicker && onPrepChange && (
          <PreparationPicker
            category={(food.category as FoodCategory) || "other"}
            selectedMethod={prepMethod || "As Served"}
            onMethodChange={onPrepChange}
            isLoading={isPrepLoading}
          />
        )}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  foodItemCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  foodItemUnselected: {
    opacity: 0.6,
  },
  foodItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  checkboxButton: {
    marginRight: Spacing.md,
    paddingTop: 2,
  },
  foodItemInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  editFields: {
    flex: 1,
    marginRight: Spacing.md,
    gap: Spacing.sm,
  },
  editInput: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    fontSize: 16,
  },
  quantityInput: {
    width: 120,
  },
  editButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  nutritionRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: Spacing.md,
    marginTop: Spacing.md,
    borderTopWidth: 1,
  },
  nutritionItem: {
    alignItems: "center",
  },
  clarificationBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: BorderRadius.xs,
    marginTop: Spacing.md,
  },
});
