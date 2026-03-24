import React, { useRef, useCallback } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SharedValue } from "react-native-reanimated";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { SwipeAction } from "./SwipeAction";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { swipeActionThreshold } from "@/constants/animations";

interface SwipeableRowProps {
  children: React.ReactNode;
  /** Right swipe action (revealed when swiping left) */
  rightAction?: {
    icon: string;
    label: string;
    backgroundColor: string;
    onAction: () => void;
  };
  /** Left swipe action (revealed when swiping right) */
  leftAction?: {
    icon: string;
    label: string;
    backgroundColor: string;
    onAction: () => void;
  };
}

export function SwipeableRow({
  children,
  rightAction,
  leftAction,
}: SwipeableRowProps) {
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const swipeableRef = useRef<SwipeableMethods>(null);

  const handleSwipeableOpen = useCallback(
    (direction: "left" | "right") => {
      if (direction === "left" && rightAction) {
        rightAction.onAction();
      } else if (direction === "right" && leftAction) {
        leftAction.onAction();
      }
      swipeableRef.current?.close();
    },
    [rightAction, leftAction],
  );

  const renderRightActions = useCallback(
    (progress: SharedValue<number>, _translation: SharedValue<number>) => {
      if (!rightAction) return null;
      return (
        <RightActionContainer
          progress={progress}
          action={rightAction}
          onPress={() => {
            rightAction.onAction();
            swipeableRef.current?.close();
          }}
        />
      );
    },
    [rightAction],
  );

  const renderLeftActions = useCallback(
    (progress: SharedValue<number>, _translation: SharedValue<number>) => {
      if (!leftAction) return null;
      return (
        <LeftActionContainer
          progress={progress}
          action={leftAction}
          onPress={() => {
            leftAction.onAction();
            swipeableRef.current?.close();
          }}
        />
      );
    },
    [leftAction],
  );

  // When reduced motion is enabled, show inline action buttons instead of swipe
  if (reducedMotion) {
    const hasActions = leftAction || rightAction;
    if (!hasActions) return <View>{children}</View>;

    return (
      <View>
        {children}
        <ReducedMotionActions
          leftAction={leftAction}
          rightAction={rightAction}
        />
      </View>
    );
  }

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderRightActions={rightAction ? renderRightActions : undefined}
      renderLeftActions={leftAction ? renderLeftActions : undefined}
      rightThreshold={swipeActionThreshold}
      leftThreshold={swipeActionThreshold}
      overshootFriction={8}
      onSwipeableWillOpen={(direction) => {
        haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      }}
      onSwipeableOpen={handleSwipeableOpen}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

function ReducedMotionActions({
  leftAction,
  rightAction,
}: Pick<SwipeableRowProps, "leftAction" | "rightAction">) {
  const { theme } = useTheme();
  const haptics = useHaptics();

  const actions = [leftAction, rightAction].filter(Boolean) as NonNullable<
    SwipeableRowProps["rightAction"]
  >[];

  return (
    <View style={styles.reducedMotionRow}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={() => {
            haptics.impact(Haptics.ImpactFeedbackStyle.Light);
            action.onAction();
          }}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [
            styles.reducedMotionButton,
            {
              backgroundColor: withOpacity(action.backgroundColor, 0.12),
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather
            name={action.icon as keyof typeof Feather.glyphMap}
            size={14}
            color={action.backgroundColor}
            accessible={false}
          />
          <ThemedText
            style={[
              styles.reducedMotionLabel,
              { color: action.backgroundColor },
            ]}
          >
            {action.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

function RightActionContainer({
  progress,
  action,
  onPress,
}: {
  progress: SharedValue<number>;
  action: NonNullable<SwipeableRowProps["rightAction"]>;
  onPress: () => void;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: Math.min(progress.value, 1),
  }));

  return (
    <Animated.View style={[styles.actionContainer, animatedStyle]}>
      <SwipeAction
        icon={action.icon}
        label={action.label}
        backgroundColor={action.backgroundColor}
        onPress={onPress}
      />
    </Animated.View>
  );
}

function LeftActionContainer({
  progress,
  action,
  onPress,
}: {
  progress: SharedValue<number>;
  action: NonNullable<SwipeableRowProps["leftAction"]>;
  onPress: () => void;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: Math.min(progress.value, 1),
  }));

  return (
    <Animated.View style={[styles.actionContainer, animatedStyle]}>
      <SwipeAction
        icon={action.icon}
        label={action.label}
        backgroundColor={action.backgroundColor}
        onPress={onPress}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  actionContainer: {
    justifyContent: "center",
  },
  reducedMotionRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  reducedMotionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    minHeight: 44,
  },
  reducedMotionLabel: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
