import React from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Alert,
  Share,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useDeleteSavedItem } from "@/hooks/useSavedItems";
import { BorderRadius, Spacing } from "@/constants/theme";
import type { SavedItem } from "@shared/schema";

interface SavedItemCardProps {
  item: SavedItem;
  onPress?: () => void;
}

export function SavedItemCard({ item, onPress }: SavedItemCardProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const deleteMutation = useDeleteSavedItem();

  const isRecipe = item.type === "recipe";
  const iconName = isRecipe ? "book-open" : "activity";
  const iconColor = isRecipe ? theme.carbsAccent : theme.proteinAccent;

  const handleDelete = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Delete Item",
      `Are you sure you want to delete "${item.title}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync(item.id);
              haptics.notification(Haptics.NotificationFeedbackType.Success);
            } catch {
              haptics.notification(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Error", "Failed to delete item. Please try again.");
            }
          },
        },
      ],
    );
  };

  const handleShare = async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);

    let content = `${item.title}\n`;

    if (item.description) {
      content += `\n${item.description}\n`;
    }

    if (item.instructions) {
      content += `\nInstructions:\n${item.instructions}\n`;
    }

    if (item.sourceProductName) {
      content += `\nSuggested for: ${item.sourceProductName}`;
    }

    try {
      await Share.share({
        message: content,
        title: item.title,
      });
    } catch {
      // User cancelled or share failed
    }
  };

  return (
    <Card
      elevation={1}
      onPress={onPress}
      accessibilityLabel={`${item.type}: ${item.title}`}
      accessibilityHint="Tap to view details"
      style={styles.card}
    >
      <View style={styles.header}>
        <View
          style={[styles.typeIcon, { backgroundColor: iconColor + "20" }]}
          accessibilityLabel={isRecipe ? "Recipe" : "Activity"}
        >
          <Feather name={iconName} size={16} color={iconColor} />
        </View>
        <View style={styles.titleContainer}>
          <ThemedText type="body" style={styles.title} numberOfLines={2}>
            {item.title}
          </ThemedText>
          {item.sourceProductName ? (
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary }}
              numberOfLines={1}
            >
              From: {item.sourceProductName}
            </ThemedText>
          ) : null}
        </View>
      </View>

      {item.description ? (
        <ThemedText
          type="small"
          style={[styles.description, { color: theme.textSecondary }]}
          numberOfLines={2}
        >
          {item.description}
        </ThemedText>
      ) : null}

      <View style={styles.metadata}>
        {item.difficulty ? (
          <View style={styles.metaItem}>
            <Feather name="bar-chart-2" size={12} color={theme.textSecondary} />
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.difficulty}
            </ThemedText>
          </View>
        ) : null}
        {item.timeEstimate ? (
          <View style={styles.metaItem}>
            <Feather name="clock" size={12} color={theme.textSecondary} />
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.timeEstimate}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={[styles.actions, { borderTopColor: theme.border }]}>
        <Pressable
          onPress={handleShare}
          accessibilityLabel="Share this item"
          accessibilityRole="button"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: theme.backgroundSecondary },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather name="share-2" size={16} color={theme.text} />
        </Pressable>
        <Pressable
          onPress={handleDelete}
          disabled={deleteMutation.isPending}
          accessibilityLabel="Delete this item"
          accessibilityRole="button"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={({ pressed }) => [
            styles.actionButton,
            { backgroundColor: theme.error + "20" },
            pressed && { opacity: 0.7 },
          ]}
        >
          {deleteMutation.isPending ? (
            <ActivityIndicator size="small" color={theme.error} />
          ) : (
            <Feather name="trash-2" size={16} color={theme.error} />
          )}
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  typeIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  titleContainer: {
    flex: 1,
    gap: Spacing.xs,
  },
  title: {
    fontWeight: "600",
  },
  description: {
    marginBottom: Spacing.sm,
  },
  metadata: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginBottom: Spacing.md,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "transparent", // Will be set by theme
    paddingTop: Spacing.md,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
  },
});
