import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ActionCard as ActionCardType } from "@shared/schemas/coach-blocks";

type FeedbackState = "idle" | "loading" | "success" | "error";

interface Props {
  block: ActionCardType;
  onAction?: (action: Record<string, unknown>) => void;
  onPressAsync?: () => Promise<void>;
}

export default function ActionCard({ block, onAction, onPressAsync }: Props) {
  const { theme } = useTheme();
  const [state, setState] = useState<FeedbackState>("idle");

  const handlePress = useCallback(async () => {
    if (state !== "idle") return;
    if (onPressAsync) {
      setState("loading");
      try {
        await onPressAsync();
        setState("success");
        setTimeout(() => setState("idle"), 1500);
      } catch {
        setState("error");
        setTimeout(() => setState("idle"), 1500);
      }
    } else {
      onAction?.(block.action as Record<string, unknown>);
    }
  }, [state, onPressAsync, onAction, block.action]);

  const label =
    state === "success"
      ? "Done"
      : state === "error"
        ? "Failed"
        : block.actionLabel;

  const buttonBg =
    state === "success"
      ? "#008A38" // hardcoded success color
      : state === "error"
        ? theme.error
        : theme.link;

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
      accessible={false}
    >
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>{block.title}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {block.subtitle}
        </Text>
      </View>
      <Pressable
        style={[styles.button, { backgroundColor: buttonBg }]}
        onPress={handlePress}
        disabled={state === "loading"}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {state === "loading" ? (
          <ActivityIndicator size="small" color="#FFFFFF" /> // hardcoded
        ) : (
          <Text style={styles.buttonText}>{label}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  content: { flex: 1, marginRight: 12 },
  title: { fontSize: 14, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 2 },
  button: {
    minHeight: 44,
    minWidth: 64,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" }, // hardcoded
});
