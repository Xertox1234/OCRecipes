import React, { useState, useCallback, useEffect } from "react";
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

interface FallbackImageProps
  extends Omit<ImageProps, "source" | "accessibilityLabel" | "alt"> {
  /** Image source with optional URI. Shows fallback when URI is missing or load fails. */
  source: { uri: string | undefined | null } | undefined | null;
  /** Custom fallback element. When omitted, a default themed icon placeholder is shown. */
  fallback?: React.ReactNode;
  /** Icon name for the default fallback placeholder. Defaults to "image". */
  fallbackIcon?: FeatherIconName;
  /** Size of the default fallback icon. Defaults to 24. */
  fallbackIconSize?: number;
  /** Color of the default fallback icon. Defaults to theme.textSecondary. */
  fallbackIconColor?: string;
  /** Style applied to the image and fallback container. Must include dimensions. */
  style?: StyleProp<ImageStyle>;
  /** Style applied only to the fallback container (merged with style). */
  fallbackStyle?: StyleProp<ViewStyle>;
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
 *
 * DECORATIVE BY DESIGN — neither branch is an accessibility element, and the
 * component deliberately does NOT accept `accessibilityLabel` or `alt`.
 * React Native gates image accessibility on
 * `accessible={props.alt !== undefined ? true : props.accessible}`
 * (identically in Image.ios.js and Image.android.js), so the label this
 * component used to accept was silently inert. Device-confirmed 2026-08-04:
 * the hero image rendered `content-desc='Image of coca-cola'` with
 * `focusable=false` in the Android tree — a description TalkBack skips.
 *
 * Every call site that passed a label was naming an image whose name is
 * already carried by adjacent visible text, so honouring the label would
 * have added a double-announcement rather than fixing anything. Both props
 * are omitted from the public type so the next consumer gets a compile
 * error instead of silence. An image that genuinely needs its own name
 * belongs in an `accessible` group wrapper at the call site — see
 * `client/components/nutrition/CapturedPhotos.tsx`.
 */
export function FallbackImage({
  source,
  fallback,
  fallbackIcon = "image",
  fallbackIconSize = 24,
  fallbackIconColor,
  style,
  fallbackStyle,
  onError,
  ...imageProps
}: FallbackImageProps) {
  const { theme } = useTheme();
  const [hasError, setHasError] = useState(false);

  const sourceUri = source?.uri;
  useEffect(() => {
    setHasError(false);
  }, [sourceUri]);

  const handleError = useCallback(
    (event: NativeSyntheticEvent<ImageErrorEventData>) => {
      setHasError(true);
      onError?.(event);
    },
    [onError],
  );

  const validSource = hasValidUri(source) ? source : null;
  const showFallback = !validSource || hasError;

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
        accessible={false}
        importantForAccessibility="no"
      >
        <Feather
          name={fallbackIcon}
          size={fallbackIconSize}
          color={fallbackIconColor ?? theme.textSecondary}
          accessible={false}
        />
      </View>
    );
  }

  return (
    <Image
      source={{ uri: validSource.uri }}
      style={style}
      accessible={false}
      importantForAccessibility="no"
      onError={handleError}
      {...imageProps}
    />
  );
}
