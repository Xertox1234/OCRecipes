import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  type StyleProp,
  type ViewStyle,
  type ImageStyle,
} from "react-native";
import { Image, type ImageProps, type ImageErrorEventData } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";
import { hasValidUri } from "@/components/FallbackImage-utils";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

interface FallbackImageProps
  extends Omit<
    ImageProps,
    // `aria-label` has to go too: RN resolves it AHEAD of accessibilityLabel
    // (`props['aria-label'] ?? props.accessibilityLabel`), so omitting only
    // the latter would leave a second, equally inert way in through
    // `{...imageProps}` — and the compile-error guarantee below would be false.
    "source" | "accessibilityLabel" | "alt" | "aria-label"
  > {
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
 * component deliberately does NOT accept `accessibilityLabel` or `alt`. This
 * was originally forced by RN Image's own gating —
 * `accessible={props.alt !== undefined ? true : props.accessible}`
 * (identically in Image.ios.js and Image.android.js) — which made a label
 * silently inert. Device-confirmed 2026-08-04: the hero image rendered
 * `content-desc='Image of coca-cola'` with `focusable=false` in the Android
 * tree — a description TalkBack skips. The component now renders
 * expo-image's `Image` (2026-09), which does not gate accessibility on `alt`
 * the same way, but the omission is kept as a deliberate design decision
 * independent of that: every call site's image name is already carried by
 * adjacent visible text (see below).
 *
 * Every call site that passed a label was naming an image whose name is
 * already carried by adjacent visible text, so honouring the label would
 * have added a double-announcement rather than fixing anything. All three
 * naming props (`accessibilityLabel`, `alt`, `aria-label`) are omitted from
 * the public type so the next consumer gets a compile error instead of
 * silence. An image that genuinely needs its own name
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
    (event: ImageErrorEventData) => {
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
        // Unlike the image branch, this one HAS a child: the Feather glyph
        // below renders as a Text node holding a private-use codepoint
        // (U+F205 etc.). `importantForAccessibility="no"` would exclude only
        // this View, leaving that child in the Android accessibility tree
        // where TalkBack could announce the raw glyph. "no-hide-descendants"
        // excludes the subtree; `accessibilityElementsHidden` is the iOS
        // half, which ignores importantForAccessibility entirely.
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
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
      // Caching only — deliberately no explicit `contentFit` here.
      // expo-image's default ("cover") already matches RN Image's old
      // default, and several call sites still pass the deprecated
      // `resizeMode` compat prop (e.g. "contain" for nutrition-label
      // photos) via `imageProps` below; expo-image supports `resizeMode`
      // as a compat prop for exactly this migration, so setting our own
      // `contentFit` here would fight it.
      cachePolicy="memory-disk"
      accessible={false}
      importantForAccessibility="no"
      onError={handleError}
      {...imageProps}
    />
  );
}
