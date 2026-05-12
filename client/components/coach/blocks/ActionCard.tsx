import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { ActionCard as ActionCardType } from "@shared/schemas/coach-blocks";

type FeedbackState = "idle" | "loading" | "success" | "error";

interface Props {
  block: ActionCardType;
  onAction?: (action: Record<string, unknown>) => void;
  onPressAsync?: () => Promise<void>;
}

const ActionCard = React.memo(function ActionCard({
  block,
  onAction,
  onPressAsync,
}: Props) {
  const { theme } = useTheme();
  const [state, setState] = useState<FeedbackState>("idle");
  const stateRef = useRef<FeedbackState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFeedbackState = useCallback((s: FeedbackState) => {
    stateRef.current = s;
    setState(s);
    // Announce state transitions to screen readers. The Pressable below has
    // `accessibilityLiveRegion="polite"` which covers Android; iOS-only here
    // to avoid Android double-announcing. See docs/rules/accessibility.md.
    if (Platform.OS === "ios") {
      if (s === "success") {
        AccessibilityInfo.announceForAccessibility("Done");
      } else if (s === "error") {
        AccessibilityInfo.announceForAccessibility("Failed");
      }
    }
  }, []);

  const handlePress = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (onPressAsync) {
      setFeedbackState("loading");
      try {
        await onPressAsync();
        setFeedbackState("success");
        timerRef.current = setTimeout(() => setFeedbackState("idle"), 1500);
      } catch {
        setFeedbackState("error");
        timerRef.current = setTimeout(() => setFeedbackState("idle"), 1500);
      }
    } else {
      onAction?.(block.action as Record<string, unknown>);
    }
  }, [onPressAsync, onAction, block.action, setFeedbackState]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const label =
    state === "success"
      ? "Done"
      : state === "error"
        ? "Failed"
        : block.actionLabel;

  const buttonBg =
    state === "success"
      ? theme.success
      : state === "error"
        ? theme.error
        : theme.link;

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
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
        disabled={state !== "idle"}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
        accessibilityState={{ disabled: state !== "idle" }}
      >
        {state === "loading" ? (
          <ActivityIndicator size="small" color="#FFFFFF" /> // hardcoded
        ) : (
          <Text style={styles.buttonText}>{label}</Text>
        )}
      </Pressable>
    </View>
  );
});

export default ActionCard;

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
