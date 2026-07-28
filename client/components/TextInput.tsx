import React, { forwardRef, useEffect, useState } from "react";
import {
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  StyleSheet,
  View,
  ViewStyle,
  StyleProp,
  Pressable,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { BorderRadius, Spacing, FontFamily } from "@/constants/theme";
import { focusTimingConfig } from "@/constants/animations";
import {
  shouldFloatLabel,
  getRestBorderColor,
  resolvePlaceholder,
  resolveInputAccessibilityLabel,
  LABELLED_INPUT_GEOMETRY,
} from "./text-input-utils";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

interface TextInputProps extends Omit<RNTextInputProps, "style"> {
  /** Left icon name from Feather icons */
  leftIcon?: FeatherIconName;
  /** Right icon name from Feather icons */
  rightIcon?: FeatherIconName;
  /** Callback when right icon is pressed */
  onRightIconPress?: () => void;
  /** Accessibility label for the right icon button (e.g. "Toggle password visibility") */
  rightIconAccessibilityLabel?: string;
  /** Container style */
  containerStyle?: StyleProp<ViewStyle>;
  /** Input style */
  style?: StyleProp<ViewStyle>;
  /** Error state */
  error?: boolean;
  /** Error message announced by screen readers when error is true */
  errorMessage?: string;
  /**
   * Floating label: rests in the placeholder position and floats up when the
   * field gains focus or content. While resting it suppresses `placeholder`;
   * it also becomes the input's accessible name unless `accessibilityLabel`
   * is set.
   */
  label?: string;
}

export const TextInput = forwardRef<RNTextInput, TextInputProps>(
  (
    {
      leftIcon,
      rightIcon,
      onRightIconPress,
      rightIconAccessibilityLabel,
      containerStyle,
      style,
      error,
      errorMessage,
      accessibilityHint,
      accessibilityLabel,
      label,
      placeholder,
      value,
      defaultValue,
      onChangeText,
      onFocus,
      onBlur,
      ...props
    },
    ref,
  ) => {
    const { theme, isDark } = useTheme();
    const { reducedMotion } = useAccessibility();

    const [isFocused, setIsFocused] = useState(false);
    // Uncontrolled inputs still float the label correctly: track the text
    // locally and prefer the controlled `value` when provided.
    const [internalValue, setInternalValue] = useState(defaultValue ?? "");
    const effectiveValue = value !== undefined ? value : internalValue;
    const floated = shouldFloatLabel(isFocused, effectiveValue);

    const focusProgress = useSharedValue(0);
    const labelProgress = useSharedValue(floated ? 1 : 0);

    // Reduced motion snaps to the end state instead of animating — the state
    // change itself must never be dropped.
    const focusTiming = {
      ...focusTimingConfig,
      duration: reducedMotion ? 0 : focusTimingConfig.duration,
    };

    useEffect(() => {
      // Deliberately duplicates focusTiming rather than referencing it: the
      // local is a fresh object every render, and depending on it would make
      // this effect re-fire per render.
      labelProgress.value = withTiming(floated ? 1 : 0, {
        ...focusTimingConfig,
        duration: reducedMotion ? 0 : focusTimingConfig.duration,
      });
    }, [floated, reducedMotion, labelProgress]);

    const handleFocus: RNTextInputProps["onFocus"] = (e) => {
      setIsFocused(true);
      focusProgress.value = withTiming(1, focusTiming);
      onFocus?.(e);
    };

    const handleBlur: RNTextInputProps["onBlur"] = (e) => {
      setIsFocused(false);
      focusProgress.value = withTiming(0, focusTiming);
      onBlur?.(e);
    };

    const handleChangeText = (text: string) => {
      setInternalValue(text);
      onChangeText?.(text);
    };

    // Figma design colors
    const backgroundColor = isDark
      ? theme.backgroundSecondary // #2C2420 in dark
      : theme.backgroundDefault; // #FAF6F0 in light

    // Captured as plain strings OUTSIDE the worklets below — never call an
    // imported function inside a worklet body without its own directive.
    const restBorderColor = getRestBorderColor(
      isDark,
      theme.border,
      theme.link,
    );
    const focusedColor = theme.link;
    const errorColor = theme.error;
    const labelRestColor = theme.textSecondary;
    const hasError = !!error;
    // Same rule as the colors above — captured as plain numbers outside the
    // worklet rather than reached through the imported geometry object.
    const labelFloatTranslateY = LABELLED_INPUT_GEOMETRY.labelFloatTranslateY;
    const labelFloatScale = LABELLED_INPUT_GEOMETRY.labelFloatScale;

    const animatedBorderStyle = useAnimatedStyle(() => ({
      borderColor: hasError
        ? errorColor
        : interpolateColor(
            focusProgress.value,
            [0, 1],
            [restBorderColor, focusedColor],
          ),
    }));

    const animatedLabelStyle = useAnimatedStyle(() => ({
      transform: [
        {
          translateY: interpolate(
            labelProgress.value,
            [0, 1],
            [0, labelFloatTranslateY],
          ),
        },
        {
          scale: interpolate(labelProgress.value, [0, 1], [1, labelFloatScale]),
        },
      ],
      color: hasError
        ? errorColor
        : interpolateColor(
            focusProgress.value,
            [0, 1],
            [labelRestColor, focusedColor],
          ),
    }));

    const placeholderColor = theme.textSecondary;

    return (
      <Animated.View
        style={[
          styles.container,
          label ? styles.labelledContainer : null,
          { backgroundColor },
          animatedBorderStyle,
          containerStyle,
        ]}
      >
        {leftIcon && (
          <Feather
            name={leftIcon}
            size={20}
            color={theme.textSecondary}
            style={styles.leftIcon}
          />
        )}
        <View style={styles.inputArea}>
          {label ? (
            <Animated.Text
              accessible={false}
              importantForAccessibility="no"
              numberOfLines={1}
              style={[
                styles.label,
                { left: leftIcon ? 0 : Spacing.lg },
                animatedLabelStyle,
              ]}
            >
              {label}
            </Animated.Text>
          ) : null}
          <RNTextInput
            ref={ref}
            placeholder={resolvePlaceholder(label, placeholder, floated)}
            placeholderTextColor={placeholderColor}
            value={value}
            defaultValue={defaultValue}
            onChangeText={handleChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            accessibilityLabel={resolveInputAccessibilityLabel(
              accessibilityLabel,
              label,
            )}
            accessibilityHint={
              error && errorMessage
                ? accessibilityHint
                  ? `${accessibilityHint}. ${errorMessage}`
                  : errorMessage
                : accessibilityHint
            }
            aria-invalid={error ? true : undefined}
            style={[
              styles.input,
              {
                color: theme.text,
                paddingLeft: leftIcon ? 0 : Spacing.lg,
              },
              label ? styles.inputWithLabel : null,
              style,
            ]}
            {...props}
          />
        </View>
        {rightIcon &&
          (onRightIconPress ? (
            <Pressable
              onPress={onRightIconPress}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={
                rightIconAccessibilityLabel ?? "Toggle visibility"
              }
              style={styles.rightIcon}
            >
              <Feather name={rightIcon} size={20} color={theme.textSecondary} />
            </Pressable>
          ) : (
            <Feather
              name={rightIcon}
              size={20}
              color={theme.textSecondary}
              style={styles.rightIcon}
            />
          ))}
      </Animated.View>
    );
  },
);

TextInput.displayName = "TextInput";

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    // `stretch`, not `center`: a taller child (a multiline input) must grow the
    // bordered box rather than overflow it. With `center` + a fixed height the
    // text rendered straight through the border.
    alignItems: "stretch",
    // minHeight, not height — same reason.
    minHeight: Spacing.inputHeight,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    // Constant width in both modes so the focus transition never shifts
    // layout — dark mode rests on a transparent border color instead of
    // the previous borderWidth: 0.
    borderWidth: LABELLED_INPUT_GEOMETRY.borderWidth,
  },
  // A labelled field stacks the floated label above the value, so it needs
  // more room than a plain single-row input.
  labelledContainer: {
    minHeight: LABELLED_INPUT_GEOMETRY.containerMinHeight,
  },
  leftIcon: {
    marginRight: Spacing.sm,
    // The row stretches its children; icons opt back out.
    alignSelf: "center",
  },
  rightIcon: {
    marginLeft: Spacing.sm,
    alignSelf: "center",
  },
  inputArea: {
    flex: 1,
    justifyContent: "center",
  },
  input: {
    fontFamily: FontFamily.regular,
    fontSize: 14,
    // Fills the stretched row so the whole field stays tappable, while still
    // letting a multiline minHeight grow the container.
    flexGrow: 1,
  },
  inputWithLabel: {
    paddingTop: LABELLED_INPUT_GEOMETRY.inputPaddingTop,
    paddingBottom: LABELLED_INPUT_GEOMETRY.inputPaddingBottom,
    // Explicit line height so the label/value spacing is arithmetic we control
    // rather than a platform default — see LABELLED_INPUT_GEOMETRY.
    lineHeight: LABELLED_INPUT_GEOMETRY.inputLineHeight,
    // Padding above now positions the text on both platforms; `top` keeps
    // Android's EditText from re-centering it and reintroducing the overlap.
    textAlignVertical: "top",
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
