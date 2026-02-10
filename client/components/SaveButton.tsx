import React, { useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  ViewStyle,
  StyleProp,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useCreateSavedItem } from "@/hooks/useSavedItems";
import { usePremiumContext } from "@/context/PremiumContext";
import { BorderRadius } from "@/constants/theme";
import type { CreateSavedItemInput } from "@shared/schemas/saved-items";

type SaveState = "idle" | "saving" | "saved" | "error";

interface SaveButtonProps {
  item: CreateSavedItemInput;
  style?: StyleProp<ViewStyle>;
  onSaved?: () => void;
}

export function SaveButton({ item, style, onSaved }: SaveButtonProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { features } = usePremiumContext();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const createSavedItem = useCreateSavedItem();
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handlePress = async () => {
    if (saveState === "saving" || saveState === "saved") return;

    setSaveState("saving");
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);

    try {
      const result = await createSavedItem.mutateAsync(item);

      if (result.limitReached) {
        setSaveState("idle");
        haptics.notification(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          "Library Full",
          `You've reached the limit of ${features.maxSavedItems} saved items. Upgrade to Premium for unlimited saves, or delete some items to make room.`,
          [{ text: "OK", style: "default" }],
        );
        return;
      }

      setSaveState("saved");
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      onSaved?.();
    } catch {
      setSaveState("error");
      haptics.notification(Haptics.NotificationFeedbackType.Error);

      // Reset to idle after a short delay
      resetTimeoutRef.current = setTimeout(() => setSaveState("idle"), 2000);
    }
  };

  const getIconName = (): keyof typeof Feather.glyphMap => {
    switch (saveState) {
      case "saving":
        return "bookmark"; // Will show spinner instead
      case "saved":
        return "check";
      case "error":
        return "alert-circle";
      default:
        return "bookmark";
    }
  };

  const getBackgroundColor = () => {
    switch (saveState) {
      case "saved":
        return theme.success;
      case "error":
        return theme.error;
      default:
        return theme.backgroundSecondary;
    }
  };

  const getIconColor = () => {
    switch (saveState) {
      case "saved":
      case "error":
        return theme.buttonText;
      default:
        return theme.text;
    }
  };

  const getAccessibilityLabel = () => {
    switch (saveState) {
      case "saving":
        return "Saving item";
      case "saved":
        return "Item saved";
      case "error":
        return "Failed to save, tap to retry";
      default:
        return `Save ${item.title}`;
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={saveState === "saving" || saveState === "saved"}
      accessibilityLabel={getAccessibilityLabel()}
      accessibilityRole="button"
      accessibilityState={{
        disabled: saveState === "saving" || saveState === "saved",
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: getBackgroundColor(),
          opacity: pressed && saveState === "idle" ? 0.7 : 1,
        },
        style,
      ]}
    >
      {saveState === "saving" ? (
        <ActivityIndicator size="small" color={theme.text} />
      ) : (
        <Feather name={getIconName()} size={20} color={getIconColor()} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
  },
});
