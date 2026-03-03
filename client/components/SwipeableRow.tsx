import React, { useRef, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SharedValue } from "react-native-reanimated";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { SwipeAction } from "./SwipeAction";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
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

  // When reduced motion is enabled, don't use swipe — actions are available
  // through the existing expand/button UI
  if (reducedMotion) {
    return <View>{children}</View>;
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
});
