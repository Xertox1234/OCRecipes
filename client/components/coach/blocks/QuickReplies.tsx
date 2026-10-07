import React from "react";
import { ScrollView, Text, StyleSheet } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { PressableScale } from "@/components/PressableScale";
import { withOpacity } from "@/constants/theme";
import { quickRepliesExitDuration } from "@/constants/animations";
import type { QuickReplies as QuickRepliesType } from "@shared/schemas/coach-blocks";

interface Props {
  block: QuickRepliesType;
  // Accepts blockKey so the parent can pass a stable useCallback ref
  // instead of an inline closure (preserves React.memo bail-out).
  onSelect?: (message: string, blockKey?: string) => void;
  blockKey?: string;
  used?: boolean;
}

const QuickReplies = React.memo(function QuickReplies({
  block,
  onSelect,
  blockKey,
  used,
}: Props) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  // Unmounting the Animated.View plays its exit, so the row fades out
  // instead of vanishing when a reply is picked.
  if (used) return null;
  return (
    <Animated.View
      exiting={
        reducedMotion ? undefined : FadeOut.duration(quickRepliesExitDuration)
      }
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        {block.options.map((option, i) => (
          <PressableScale
            key={i}
            scaleTo={0.95}
            style={[
              styles.chip,
              {
                backgroundColor: withOpacity(theme.link, 0.15),
                borderColor: withOpacity(theme.link, 0.3),
              },
            ]}
            onPress={() => {
              haptics.selection();
              onSelect?.(option.message, blockKey);
            }}
            hitSlop={{ top: 16, bottom: 16, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={option.label}
          >
            <Text style={[styles.chipText, { color: theme.link }]}>
              {option.label}
            </Text>
          </PressableScale>
        ))}
      </ScrollView>
    </Animated.View>
  );
});

export default QuickReplies;

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  content: { gap: 8, paddingHorizontal: 2 },
  chip: {
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  chipText: { fontSize: 13 },
});
