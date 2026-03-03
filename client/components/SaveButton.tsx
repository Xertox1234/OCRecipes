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
import {
  type SaveState,
  getSaveIconName,
  getSaveBackgroundColorKey,
  getSaveIconColorKey,
  getSaveAccessibilityLabel,
} from "./save-button-utils";

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

  return (
    <Pressable
      onPress={handlePress}
      disabled={saveState === "saving" || saveState === "saved"}
      accessibilityLabel={getSaveAccessibilityLabel(saveState, item.title)}
      accessibilityRole="button"
      accessibilityState={{
        disabled: saveState === "saving" || saveState === "saved",
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: theme[getSaveBackgroundColorKey(saveState)],
          opacity: pressed && saveState === "idle" ? 0.7 : 1,
        },
        style,
      ]}
    >
      {saveState === "saving" ? (
        <ActivityIndicator size="small" color={theme.text} />
      ) : (
        <Feather
          name={getSaveIconName(saveState)}
          size={20}
          color={theme[getSaveIconColorKey(saveState)]}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
  },
});
