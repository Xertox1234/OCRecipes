import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

interface InlineErrorProps {
  message?: string | null;
  style?: StyleProp<ViewStyle>;
}

export function InlineError({ message, style }: InlineErrorProps) {
  const { theme } = useTheme();

  if (!message) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.error, 0.06) },
        style,
      ]}
    >
      <Feather name="alert-circle" size={16} color={theme.error} />
      <ThemedText
        type="small"
        style={{ color: theme.error, marginLeft: Spacing.sm, flex: 1 }}
      >
        {message}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
});
