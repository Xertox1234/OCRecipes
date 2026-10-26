import React, { useEffect } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { AbsoluteFill, FontFamily, Spacing } from "@/constants/theme";
import { focusTimingConfig } from "@/constants/animations";
import { LABELLED_INPUT_GEOMETRY, shouldFloatLabel } from "./text-input-utils";
import {
  FOCUS_RING_WIDTH,
  resolveFieldColors,
  resolveFieldRadius,
} from "./field-focus-utils";
import type { FieldFocus } from "./useFieldFocus";

interface FocusFieldProps {
  /** From `useFieldFocus()` — the same object whose handlers the input uses. */
  focus: FieldFocus;
  /** The visible field's look (fill, edge, radius, size). Overlays follow its radius. */
  style?: StyleProp<ViewStyle>;
  /**
   * Floating label: rests in the value position and floats up on focus or
   * content. Hidden from screen readers — the input carries the accessible
   * name. A labelled field is at least 56px tall.
   */
  label?: string;
  /** Whether the input has text — keeps the label floated after blur. */
  hasValue?: boolean;
  /** Error state: the ring shows in the error colour at full strength. */
  error?: boolean;
  /** Test id for the field container (the element that draws the field). */
  testID?: string;
  children: React.ReactNode;
}

/**
 * The focus look shared by every text field: on focus a warm fill
 * (`theme.focusFill`) fades in under the input and a 2px ring
 * (`theme.focusRing`) over it, both following the visible field's corner
 * radius. Wrap the element that draws the field — never put a ring on the
 * inner input as well.
 */
export function FocusField({
  focus,
  style,
  label,
  hasValue,
  error,
  testID,
  children,
}: FocusFieldProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

  const flat: ViewStyle = StyleSheet.flatten(style) ?? {};
  const radius = resolveFieldRadius(flat);
  const hasError = !!error;
  // Plain values captured OUTSIDE the worklets below — never call an imported
  // function or reach through an imported object inside a worklet body.
  const ringColor = resolveFieldColors({
    hasError,
    errorColor: theme.error,
    ringColor: theme.focusRing,
  }).ring;
  const errorColor = theme.error;
  const labelRestColor = theme.textSecondary;
  const labelFocusColor = theme.focusRing;
  const labelFloatTranslateY = LABELLED_INPUT_GEOMETRY.labelFloatTranslateY;
  const labelFloatScale = LABELLED_INPUT_GEOMETRY.labelFloatScale;
  const progress = focus.progress;

  // shouldFloatLabel takes the text itself; FocusField only knows whether
  // there is any, so a non-empty stand-in carries that fact.
  const floated = shouldFloatLabel(focus.focused, hasValue ? "x" : undefined);
  const labelProgress = useSharedValue(floated ? 1 : 0);

  useEffect(() => {
    labelProgress.set(
      withTiming(floated ? 1 : 0, {
        ...focusTimingConfig,
        duration: reducedMotion ? 0 : focusTimingConfig.duration,
      }),
    );
  }, [floated, reducedMotion, labelProgress]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: hasError ? 1 : progress.get(),
    borderColor: ringColor,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          labelProgress.get(),
          [0, 1],
          [0, labelFloatTranslateY],
        ),
      },
      {
        scale: interpolate(labelProgress.get(), [0, 1], [1, labelFloatScale]),
      },
    ],
    color: hasError
      ? errorColor
      : interpolateColor(
          progress.get(),
          [0, 1],
          [labelRestColor, labelFocusColor],
        ),
  }));

  // The label lines up with the field's own left padding; a field that pads
  // its inner input instead gets the boxed TextInput's text inset.
  const paddingLeft =
    flat.paddingLeft ?? flat.paddingHorizontal ?? flat.padding;
  const labelLeft = typeof paddingLeft === "number" ? paddingLeft : Spacing.lg;

  return (
    <Animated.View
      testID={testID}
      style={[style, label ? styles.labelled : null]}
    >
      <Animated.View
        testID="focus-field-fill"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          AbsoluteFill,
          { borderRadius: radius, backgroundColor: theme.focusFill },
          fillStyle,
        ]}
      />
      {label ? (
        // Before the children so the input stays on top and takes the tap.
        <Animated.Text
          testID="focus-field-label"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          numberOfLines={1}
          style={[styles.label, { left: labelLeft }, labelStyle]}
        >
          {label}
        </Animated.Text>
      ) : null}
      {children}
      <Animated.View
        testID="focus-field-ring"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          AbsoluteFill,
          { borderRadius: radius, borderWidth: FOCUS_RING_WIDTH },
          ringStyle,
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // After the caller's style: the floated label needs the two-row height.
  labelled: {
    minHeight: LABELLED_INPUT_GEOMETRY.containerMinHeight,
  },
  label: {
    position: "absolute",
    top: LABELLED_INPUT_GEOMETRY.labelRestTop,
    fontSize: 14,
    lineHeight: LABELLED_INPUT_GEOMETRY.labelLineHeight,
    fontFamily: FontFamily.regular,
    transformOrigin: "left",
  },
});
