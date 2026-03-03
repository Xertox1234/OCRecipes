import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, FontFamily } from "@/constants/theme";

interface SwipeActionProps {
  icon: string;
  label: string;
  backgroundColor: string;
  color?: string;
  onPress: () => void;
}

export function SwipeAction({
  icon,
  label,
  backgroundColor,
  color,
  onPress,
}: SwipeActionProps) {
  const { theme } = useTheme();
  const resolvedColor = color ?? theme.buttonText;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.action, { backgroundColor }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather
        name={icon as keyof typeof Feather.glyphMap}
        size={20}
        color={resolvedColor}
        accessible={false}
      />
      <ThemedText
        type="caption"
        style={[styles.label, { color: resolvedColor }]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 80,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.xs,
  },
  label: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
  },
});
