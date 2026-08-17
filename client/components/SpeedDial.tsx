import React, { useEffect } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  Shadows,
  FAB_SIZE,
  TAB_BAR_HEIGHT,
  withOpacity,
} from "@/constants/theme";
import { speedDialStaggerDelay } from "@/constants/animations";

interface SpeedDialAction {
  icon: string;
  label: string;
  onPress: () => void;
}

interface SpeedDialProps {
  actions: SpeedDialAction[];
  onClose: () => void;
}

export function SpeedDial({ actions, onClose }: SpeedDialProps) {
  const { theme, isDark } = useTheme();
  const { reducedMotion } = useAccessibility();

  const backdropEntering = reducedMotion ? undefined : FadeIn.duration(200);

  // Android's ONLY exit from the open menu. `onAccessibilityEscape` below is
  // iOS-only, and the FAB sits outside this modal's focus order: device-
  // confirmed 2026-08-17 that once the full-screen backdrop leaves the a11y
  // tree, VoiceOver correctly contains focus and stops at the last action
  // instead of reaching the FAB. Without this, a TalkBack user who opens the
  // menu and wants none of the actions is stuck. No open/focus gating needed —
  // ScanFAB renders <SpeedDial> only while `menuOpen`, so this component's
  // mount lifetime IS the menu-open lifetime (unlike `useSheetBackHandler`,
  // whose gorhom hosts outlive their sheets and therefore need ref gates).
  useEffect(() => {
    if (Platform.OS !== "android") return;

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onClose();
        return true;
      },
    );

    return () => subscription.remove();
  }, [onClose]);

  return (
    <View
      style={styles.wrapper}
      accessibilityViewIsModal
      // Two-finger scrub is the canonical VoiceOver modal escape. iOS-only, so it
      // is a bonus exit, NOT the only one — the FAB stays in the a11y tree
      // (labelled "Close scan menu") to keep a dismissal path on TalkBack, which
      // has neither this prop nor a BackHandler here.
      onAccessibilityEscape={onClose}
    >
      <Animated.View
        entering={backdropEntering}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={isDark ? 30 : 40}
            tint={isDark ? "dark" : "light"}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: withOpacity("#000000", 0.2) }, // hardcoded — backdrop overlay is always black
            ]}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: withOpacity("#000000", 0.4) }, // hardcoded — backdrop overlay is always black
            ]}
          />
        )}
      </Animated.View>
      {/* Sighted tap-to-dismiss only. Hidden from the a11y tree: this is an
          `absoluteFillObject` with no visual affordance, so it overlaps every
          action's frame and VoiceOver interleaved it between the items
          (device-confirmed 2026-08-17). Focus landing here and being activated
          dismissed the menu without navigating — the reported "it just closes
          the screen". The FAB is the labelled close affordance instead. */}
      <Pressable
        testID="speed-dial-backdrop"
        style={styles.backdrop}
        onPress={onClose}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View
        style={[
          styles.actionsContainer,
          { bottom: TAB_BAR_HEIGHT + Spacing.lg + FAB_SIZE + Spacing.md },
        ]}
      >
        {actions.map((action, index) => {
          const reverseIndex = actions.length - 1 - index;
          const entering = reducedMotion
            ? undefined
            : FadeInUp.springify()
                .damping(16)
                .stiffness(180)
                .delay(reverseIndex * speedDialStaggerDelay);

          return (
            <Animated.View
              key={action.label}
              entering={entering}
              style={styles.actionRow}
            >
              {/* Visual label only. Hidden from the a11y tree because the
                  mini-FAB beside it already carries this exact string as its
                  `accessibilityLabel` — leaving both focusable announced every
                  action twice, once as dead text and once as the real button
                  (device-confirmed 2026-08-17). Container WITH a child, so it
                  needs the `no-hide-descendants` + `accessibilityElementsHidden`
                  pair; `accessible={false}` alone would leave the `Text` in the
                  Android tree (see docs/rules/accessibility.md). */}
              <View
                testID="speed-dial-action-label"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.labelContainer,
                  { backgroundColor: theme.backgroundDefault },
                  Shadows.small,
                ]}
              >
                <ThemedText
                  type="small"
                  style={[styles.label, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {action.label}
                </ThemedText>
              </View>
              <Pressable
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => [
                  styles.miniFab,
                  Shadows.medium,
                  {
                    backgroundColor: theme.accentSolid,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Feather
                  name={action.icon as keyof typeof Feather.glyphMap}
                  size={20}
                  color={theme.buttonText}
                  accessible={false}
                />
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const MINI_FAB_SIZE = 44;

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  actionsContainer: {
    position: "absolute",
    right: Spacing.xl,
    alignItems: "flex-end",
    gap: Spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  labelContainer: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  label: {
    fontFamily: FontFamily.medium,
  },
  miniFab: {
    width: MINI_FAB_SIZE,
    height: MINI_FAB_SIZE,
    borderRadius: MINI_FAB_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
});
