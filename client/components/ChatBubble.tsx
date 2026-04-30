import React, { useEffect } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  cancelAnimation,
  SlideInRight,
  SlideInLeft,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { MarkdownText } from "@/components/MarkdownText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, FontFamily, BorderRadius } from "@/constants/theme";

interface ChatBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
  onSpeak?: () => void;
  isSpeaking?: boolean;
}

function TypingIndicator() {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(dot1);
      cancelAnimation(dot2);
      cancelAnimation(dot3);
      dot1.value = 0;
      dot2.value = 0;
      dot3.value = 0;
      return;
    }
    dot1.value = withRepeat(withTiming(1, { duration: 600 }), -1, true);
    dot2.value = withRepeat(
      withDelay(200, withTiming(1, { duration: 600 })),
      -1,
      true,
    );
    dot3.value = withRepeat(
      withDelay(400, withTiming(1, { duration: 600 })),
      -1,
      true,
    );
  }, [dot1, dot2, dot3, reducedMotion]);

  const dot1Style = useAnimatedStyle(() => ({
    opacity: 0.3 + dot1.value * 0.7,
    transform: [{ translateY: -dot1.value * 3 }],
  }));

  const dot2Style = useAnimatedStyle(() => ({
    opacity: 0.3 + dot2.value * 0.7,
    transform: [{ translateY: -dot2.value * 3 }],
  }));

  const dot3Style = useAnimatedStyle(() => ({
    opacity: 0.3 + dot3.value * 0.7,
    transform: [{ translateY: -dot3.value * 3 }],
  }));

  const dotColor = theme.textSecondary;

  if (reducedMotion) {
    return (
      <View
        style={styles.typingContainer}
        accessibilityLabel="Coach is typing"
        accessibilityRole="text"
      >
        <ThemedText type="body" style={{ color: dotColor }}>
          ...
        </ThemedText>
      </View>
    );
  }

  return (
    <View
      style={styles.typingContainer}
      accessibilityLabel="Coach is typing"
      accessibilityRole="text"
    >
      <Animated.View
        style={[styles.dot, { backgroundColor: dotColor }, dot1Style]}
      />
      <Animated.View
        style={[styles.dot, { backgroundColor: dotColor }, dot2Style]}
      />
      <Animated.View
        style={[styles.dot, { backgroundColor: dotColor }, dot3Style]}
      />
    </View>
  );
}

export function ChatBubble({
  role,
  content,
  isStreaming,
  onSpeak,
  isSpeaking,
}: ChatBubbleProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const isUser = role === "user";

  if (!content && isStreaming) {
    return (
      <View
        style={[styles.bubbleRow, styles.bubbleRowAssistant]}
        accessible
        accessibilityRole="text"
      >
        <View
          style={[
            styles.bubble,
            styles.assistantBubble,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <TypingIndicator />
        </View>
      </View>
    );
  }

  if (!content) return null;

  const entering = reducedMotion
    ? undefined
    : isUser
      ? SlideInRight.springify().damping(18).stiffness(150).duration(200)
      : SlideInLeft.springify().damping(18).stiffness(150).delay(100);

  return (
    <Animated.View
      entering={entering}
      style={[
        styles.bubbleRow,
        isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant,
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${isUser ? "You" : "NutriCoach"}: ${content}`}
    >
      <View
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: theme.link }]
            : [
                styles.assistantBubble,
                { backgroundColor: theme.backgroundSecondary },
              ],
        ]}
      >
        {isUser ? (
          <ThemedText
            type="body"
            style={[styles.bubbleText, { color: theme.buttonText }]}
          >
            {content}
          </ThemedText>
        ) : (
          <MarkdownText style={{ ...styles.bubbleText, color: theme.text }}>
            {content}
          </MarkdownText>
        )}
        {!isUser && onSpeak && (
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
  },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  userBubble: {
    borderBottomRightRadius: BorderRadius.xs,
  },
  assistantBubble: {
    borderBottomLeftRadius: BorderRadius.xs,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FontFamily.regular,
  },
  typingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  speakButton: {
    alignSelf: "flex-end",
    marginTop: Spacing.xs,
    padding: 2,
  },
});
