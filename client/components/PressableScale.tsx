import React from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";

import { usePressScale } from "@/hooks/usePressScale";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<PressableProps, "style"> & {
  /** Static style only — an animated pressable can't resolve a `({ pressed })` function. */
  style?: StyleProp<ViewStyle>;
  /** Press-in scale. Defaults to the 0.98 Button tier; cards use 0.97. */
  scaleTo?: number;
};

/**
 * A Pressable that scales on press (`usePressScale`). Use it where a hook
 * can't be called directly, such as a list `renderItem`, and for cards or
 * button-shaped targets that aren't a `Button`, `Card` or `Chip`. Full-width
 * rows and inline links use a `pressed` opacity style instead.
 */
export function PressableScale({
  style,
  scaleTo = 0.98,
  disabled,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const press = usePressScale(scaleTo, { enabled: !disabled });

  const handlePressIn = (e: GestureResponderEvent) => {
    press.onPressIn();
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    press.onPressOut();
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, press.animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
