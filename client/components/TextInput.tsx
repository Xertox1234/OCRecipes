import React, { forwardRef } from "react";
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

import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, FontFamily } from "@/constants/theme";

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
      ...props
    },
    ref,
  ) => {
    const { theme, isDark } = useTheme();

    // Figma design colors
    const backgroundColor = isDark
      ? theme.backgroundSecondary // #393948 in dark
      : theme.backgroundDefault; // white in light

    const borderColor = error
      ? theme.error
      : isDark
        ? "transparent"
        : theme.border; // subtle border in light mode

    const placeholderColor = theme.textSecondary;

    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor,
            borderColor,
            borderWidth: isDark ? 0 : 1,
          },
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
        <RNTextInput
          ref={ref}
          placeholderTextColor={placeholderColor}
          accessibilityHint={
            error && errorMessage ? errorMessage : props.accessibilityHint
          }
          style={[
            styles.input,
            {
              color: theme.text,
              paddingLeft: leftIcon ? 0 : Spacing.lg,
            },
            style,
          ]}
          {...props}
        />
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
      </View>
    );
  },
);

TextInput.displayName = "TextInput";

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
  },
  leftIcon: {
    marginRight: Spacing.sm,
  },
  rightIcon: {
    marginLeft: Spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: 14,
    height: "100%",
  },
});
