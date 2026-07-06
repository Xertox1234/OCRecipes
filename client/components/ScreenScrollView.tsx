import React, { forwardRef } from "react";
import { ScrollView, ScrollViewProps } from "react-native";

import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { mergeHeaderInsetStyle } from "./screen-scroll-view-utils";

interface ScreenScrollViewProps extends ScrollViewProps {
  /** Extra spacing (e.g. `Spacing.lg`) added on top of the raw header
   * height for visual breathing room. Defaults to 0. */
  headerInsetExtra?: number;
}

/**
 * Drop-in `ScrollView` for screens rendered under a transparent header (the
 * `useScreenOptions()` default). Applies the header inset automatically so
 * new screens don't need hand-rolled `paddingTop` math or an iOS-only prop
 * like `contentInsetAdjustmentBehavior` (which no-ops on Android). See
 * `docs/rules/react-native.md`.
 *
 * CAVEAT: a caller-supplied `contentContainerStyle` with its own `paddingTop`
 * silently WINS over this guard (RN style arrays let a later entry override
 * an earlier one for the same key — see `mergeHeaderInsetStyle`). Don't set
 * `paddingTop` on `contentContainerStyle` unless you intend to replace the
 * header inset entirely.
 *
 * Screens that deliberately scroll content under the transparent header
 * (e.g. hero-image detail screens) should keep using a plain `ScrollView`
 * with their existing opt-out instead of this component.
 */
export const ScreenScrollView = forwardRef<ScrollView, ScreenScrollViewProps>(
  ({ contentContainerStyle, headerInsetExtra = 0, ...props }, ref) => {
    const headerInset = useHeaderContentInset(headerInsetExtra);

    return (
      <ScrollView
        ref={ref}
        contentContainerStyle={mergeHeaderInsetStyle(
          headerInset,
          contentContainerStyle,
        )}
        {...props}
      />
    );
  },
);

ScreenScrollView.displayName = "ScreenScrollView";
