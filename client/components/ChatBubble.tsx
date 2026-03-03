import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  cancelAnimation,
  FadeIn,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, FontFamily, BorderRadius } from "@/constants/theme";

interface ChatBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
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
        <ThemedText
          type="body"
          style={[styles.reducedMotionDots, { color: dotColor }]}
        >
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

export function ChatBubble({ role, content, isStreaming }: ChatBubbleProps) {
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

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(200)}
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
        <ThemedText
          type="body"
          style={[
            styles.bubbleText,
            isUser ? { color: theme.buttonText } : { color: theme.text },
          ]}
        >
          {content}
        </ThemedText>
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
  reducedMotionDots: {},
});
