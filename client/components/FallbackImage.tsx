import React, { useState, useCallback } from "react";
import {
  Image,
  View,
  type ImageProps,
  type ImageErrorEventData,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
  type ImageStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";
import { hasValidUri } from "@/components/FallbackImage-utils";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

interface FallbackImageProps extends Omit<ImageProps, "source"> {
  /** Image source with optional URI. Shows fallback when URI is missing or load fails. */
  source: { uri: string | undefined | null } | undefined | null;
  /** Custom fallback element. When omitted, a default themed icon placeholder is shown. */
  fallback?: React.ReactNode;
  /** Icon name for the default fallback placeholder. Defaults to "image". */
  fallbackIcon?: FeatherIconName;
  /** Size of the default fallback icon. Defaults to 24. */
  fallbackIconSize?: number;
  /** Style applied to the image and fallback container. Must include dimensions. */
  style?: StyleProp<ImageStyle>;
  /** Style applied only to the fallback container (merged with style). */
  fallbackStyle?: StyleProp<ViewStyle>;
  /** Accessibility label for both image and fallback. */
  accessibilityLabel?: string;
}

/**
 * Image component with automatic error fallback.
 *
 * Renders a standard `<Image>` when the source URI is valid and loads successfully.
 * Shows a themed fallback placeholder when:
 * - The source or URI is null/undefined
 * - The image fails to load (404, network error, etc.)
 *
 * The fallback matches the image dimensions to prevent layout shift.
 */
export function FallbackImage({
  source,
  fallback,
  fallbackIcon = "image",
  fallbackIconSize = 24,
  style,
  fallbackStyle,
  accessibilityLabel,
  onError,
  ...imageProps
}: FallbackImageProps) {
  const { theme } = useTheme();
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback(
    (event: NativeSyntheticEvent<ImageErrorEventData>) => {
      setHasError(true);
      onError?.(event);
    },
    [onError],
  );

  const showFallback = !hasValidUri(source) || hasError;

  if (showFallback) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <View
        style={[
          style as StyleProp<ViewStyle>,
          {
            backgroundColor: withOpacity(theme.text, 0.06),
            justifyContent: "center",
            alignItems: "center",
          },
          fallbackStyle,
        ]}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="image"
      >
        <Feather
          name={fallbackIcon}
          size={fallbackIconSize}
          color={theme.textSecondary}
          accessible={false}
        />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: source!.uri! }}
      style={style}
      accessibilityLabel={accessibilityLabel}
      onError={handleError}
      {...imageProps}
    />
  );
}
