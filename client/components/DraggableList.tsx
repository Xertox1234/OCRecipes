import React, { useState, useCallback } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, Shadows, withOpacity } from "@/constants/theme";

interface DraggableListProps<T> {
  items: T[];
  keyExtractor: (item: T) => string | number;
  renderItem: (item: T, index: number) => React.ReactNode;
  onReorder: (items: T[]) => void;
}

export function DraggableList<T>({
  items,
  keyExtractor,
  renderItem,
  onReorder,
}: DraggableListProps<T>) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const moveItem = useCallback(
    (fromIndex: number, direction: "up" | "down") => {
      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= items.length) return;

      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      const newItems = [...items];
      const [moved] = newItems.splice(fromIndex, 1);
      newItems.splice(toIndex, 0, moved);
      onReorder(newItems);
    },
    [items, onReorder, haptics],
  );

  return (
    <View>
      {items.map((item, index) => {
        const isActive = activeIndex === index;

        return (
          <View
            key={keyExtractor(item)}
            style={[
              styles.itemContainer,
              isActive && [Shadows.medium, styles.activeItem],
            ]}
          >
            <View style={styles.gripContainer}>
              <Pressable
                onPress={() =>
                  setActiveIndex(activeIndex === index ? null : index)
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Reorder handle"
                accessibilityHint="Tap to select, then use move buttons"
                style={styles.gripHandle}
              >
                <Feather
                  name="menu"
                  size={18}
                  color={isActive ? theme.link : withOpacity(theme.text, 0.3)}
                  accessible={false}
                />
              </Pressable>
              {isActive && (
                <View style={styles.moveButtons}>
                  <Pressable
                    onPress={() => moveItem(index, "up")}
                    disabled={index === 0}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Move up"
                    style={[
                      styles.moveButton,
                      {
                        backgroundColor: withOpacity(theme.link, 0.1),
                        opacity: index === 0 ? 0.3 : 1,
                      },
                    ]}
                  >
                    <Feather name="chevron-up" size={16} color={theme.link} />
                  </Pressable>
                  <Pressable
                    onPress={() => moveItem(index, "down")}
                    disabled={index === items.length - 1}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Move down"
                    style={[
                      styles.moveButton,
                      {
                        backgroundColor: withOpacity(theme.link, 0.1),
                        opacity: index === items.length - 1 ? 0.3 : 1,
                      },
                    ]}
                  >
                    <Feather name="chevron-down" size={16} color={theme.link} />
                  </Pressable>
                </View>
              )}
            </View>
            <View style={styles.contentContainer}>
              {renderItem(item, index)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  itemContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  activeItem: {
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  gripContainer: {
    alignItems: "center",
    paddingRight: Spacing.xs,
  },
  gripHandle: {
    padding: Spacing.xs,
    minHeight: 44,
    minWidth: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  moveButtons: {
    gap: 2,
  },
  moveButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  contentContainer: {
    flex: 1,
  },
});
