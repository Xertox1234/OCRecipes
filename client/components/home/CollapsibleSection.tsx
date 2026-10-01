import React from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
import { Spacing, FontFamily } from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";

interface CollapsibleSectionProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  isExpanded,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const chevronRotation = useSharedValue(isExpanded ? 0 : -90);
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isExpanded,
    reducedMotion,
  );

  // useCollapsibleHeight's animated height always starts at 0, regardless of
  // the initial `isExpanded` value (unlike chevronRotation above), and only
  // snaps to the real content height after the content wrapper's first
  // non-zero onLayout. A section that is ALREADY expanded on mount — the
  // cold-launch default, or a persisted "expanded" flag that resolves before
  // that first layout lands — can render the expanded chevron with a clip
  // container still animating from height 0, so no rows appear until a later
  // re-measurement (often only after the user collapses and re-expands).
  // Track the first real measurement locally so the effect below can
  // re-forward it once more, post-commit (see that effect's comment for why).
  const [hasMeasuredOnce, setHasMeasuredOnce] = React.useState(false);
  // RN's LayoutChangeEvent is pooled — by the time an effect runs, the
  // original event's `nativeEvent` has already been released/nulled. Stash
  // only the plain height value, not the event object itself.
  const pendingReforwardHeightRef = React.useRef<number | null>(null);

  const handleContentLayout = React.useCallback(
    (e: LayoutChangeEvent) => {
      const height = e.nativeEvent.layout.height;
      onContentLayout(e);
      if (!hasMeasuredOnce && height > 0) {
        pendingReforwardHeightRef.current = height;
        setHasMeasuredOnce(true);
      }
    },
    [onContentLayout, hasMeasuredOnce],
  );

  // A shared-value write issued from the FIRST onLayout does not reliably
  // reach the native view when a section is already expanded on mount: the
  // write can land before the React commit that first attaches the
  // Animated.View driven by this hook, and gets lost — the section renders
  // its expanded chevron with the clip container stuck at height 0.
  // Re-forwarding the same measurement once more here — in an effect, which
  // by definition runs AFTER that commit — reproduces the one pattern that
  // measurably works on device (confirmed via cold-launch testing on the iOS
  // Simulator; see the Updates entry on the todo this fixes for the numbers).
  React.useEffect(() => {
    if (hasMeasuredOnce && pendingReforwardHeightRef.current !== null) {
      onContentLayout({
        nativeEvent: { layout: { height: pendingReforwardHeightRef.current } },
      } as LayoutChangeEvent);
      pendingReforwardHeightRef.current = null;
    }
  }, [hasMeasuredOnce, onContentLayout]);

  // Animate chevron rotation
  React.useEffect(() => {
    if (reducedMotion) {
      chevronRotation.value = isExpanded ? 0 : -90;
    } else {
      chevronRotation.value = withTiming(
        isExpanded ? 0 : -90,
        isExpanded ? expandTimingConfig : collapseTimingConfig,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable ref
  }, [isExpanded, reducedMotion]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`${title} section`}
        accessibilityState={{ expanded: isExpanded }}
        accessibilityHint={`Double tap to ${isExpanded ? "collapse" : "expand"} section`}
      >
        <ThemedText type="body" style={styles.title}>
          {title}
        </ThemedText>
        <Animated.View style={chevronStyle}>
          <Feather
            name="chevron-down"
            size={20}
            color={theme.textSecondary}
            accessible={false}
          />
        </Animated.View>
      </Pressable>

      <Animated.View
        style={[animatedStyle, styles.clipContainer]}
        // Visual clipping (height 0) does not remove the children from the
        // a11y tree — hide them so screen readers can't focus into a
        // collapsed section (mirrors QuickLogDrawer's gating).
        aria-hidden={!isExpanded}
        importantForAccessibility={isExpanded ? "auto" : "no-hide-descendants"}
      >
        <View style={styles.contentWrapper} onLayout={handleContentLayout}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 44,
  },
  clipContainer: {
    overflow: "hidden",
  },
  contentWrapper: {
    // Position absolute ensures the content is laid out and measured
    // even when the parent animated view has height 0. Without this,
    // onLayout may not fire, leaving contentHeight at 0.
    position: "absolute",
    width: "100%",
  },
  title: {
    fontFamily: FontFamily.semiBold,
  },
});
