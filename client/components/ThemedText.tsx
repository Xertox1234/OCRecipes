import { Text, type TextProps } from "react-native";

import { useTheme } from "@/hooks/useTheme";
import { Typography } from "@/constants/theme";

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: "h1" | "h2" | "h3" | "h4" | "body" | "small" | "caption" | "link";
  /** Cap Dynamic Type scaling for text in fixed-height containers (e.g. 1.5 = max 150%). */
  maxScale?: number;
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = "body",
  maxScale,
  maxFontSizeMultiplier: _ignored,
  ...rest
}: ThemedTextProps) {
  const { theme, isDark } = useTheme();

  const getColor = () => {
    if (isDark && darkColor) {
      return darkColor;
    }

    if (!isDark && lightColor) {
      return lightColor;
    }

    if (type === "link") {
      return theme.link;
    }

    return theme.text;
  };

  const getTypeStyle = () => {
    switch (type) {
      case "h1":
        return Typography.h1;
      case "h2":
        return Typography.h2;
      case "h3":
        return Typography.h3;
      case "h4":
        return Typography.h4;
      case "body":
        return Typography.body;
      case "small":
        return Typography.small;
      case "caption":
        return Typography.caption;
      case "link":
        return Typography.link;
      default:
        return Typography.body;
    }
  };

  const getAccessibilityRole = (): "header" | undefined => {
    if (["h1", "h2", "h3", "h4"].includes(type)) {
      return "header";
    }
    return undefined;
  };

  return (
    <Text
      accessibilityRole={getAccessibilityRole()}
      maxFontSizeMultiplier={maxScale}
      style={[{ color: getColor() }, getTypeStyle(), style]}
      {...rest}
    />
  );
}
