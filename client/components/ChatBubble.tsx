import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { SlideInRight, SlideInLeft } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { MarkdownText } from "@/components/MarkdownText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, FontFamily, BorderRadius } from "@/constants/theme";

interface ChatBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  /** Kept for call-site backwards compatibility — no longer affects rendering. */
  isStreaming?: boolean;
  onSpeak?: () => void;
  isSpeaking?: boolean;
}

export function ChatBubble({
  role,
  content,
  onSpeak,
  isSpeaking,
}: ChatBubbleProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const isUser = role === "user";

  if (!content) return null;

  const entering = reducedMotion
    ? undefined
    : isUser
      ? SlideInRight.springify().damping(18).stiffness(150).duration(200)
      : SlideInLeft.springify().damping(18).stiffness(150).delay(100);

  if (isUser) {
    return (
      <Animated.View
        entering={entering}
        style={[styles.bubbleRow, styles.bubbleRowUser]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`You: ${content}`}
      >
        <View style={[styles.userBubble, { backgroundColor: theme.link }]}>
          <ThemedText
            type="body"
            style={[styles.userBubbleText, { color: theme.buttonText }]}
          >
            {content}
          </ThemedText>
        </View>
      </Animated.View>
    );
  }

  // Assistant — canvas layout: avatar dot + full-width text
  return (
    <Animated.View
      entering={entering}
      style={[styles.bubbleRow, styles.bubbleRowAssistant]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`NutriCoach: ${content}`}
    >
      <View style={[styles.avatarDot, { backgroundColor: theme.link }]} />
      <View style={styles.assistantContent}>
        <MarkdownText
          style={{ ...styles.assistantBubbleText, color: theme.text }}
        >
          {content}
        </MarkdownText>
        {onSpeak && (
          <Pressable
            onPress={onSpeak}
            style={styles.speakButton}
            accessibilityRole="button"
            accessibilityLabel={
              isSpeaking ? "Stop reading aloud" : "Read aloud"
            }
            accessibilityState={{ selected: isSpeaking }}
            hitSlop={8}
          >
            <Ionicons
              name={isSpeaking ? "stop-circle" : "volume-high"}
              size={16}
              color={theme.textSecondary}
            />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubbleRow: {
    flexDirection: "row",
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  bubbleRowUser: {
    justifyContent: "flex-end",
  },
  bubbleRowAssistant: {
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap: 9, // avatar dot width 22px; gap keeps text column aligned across layouts
  },
  // User bubble
  userBubble: {
    maxWidth: "80%",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.xs,
  },
  userBubbleText: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FontFamily.regular,
  },
  // Assistant canvas
  avatarDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 2,
    flexShrink: 0,
  },
  assistantContent: {
    flex: 1,
  },
  assistantBubbleText: {
    fontSize: 15,
    lineHeight: 25,
    fontFamily: FontFamily.regular,
  },
  // Shared
  speakButton: {
    alignSelf: "flex-end",
    marginTop: Spacing.xs,
    padding: 2,
  },
});
