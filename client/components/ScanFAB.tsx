import React, { useState, useCallback, useMemo } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { SpeedDial } from "@/components/SpeedDial";
import {
  getActionsByGroup,
  navigateAction,
} from "@/components/home/action-config";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  BorderRadius,
  FAB_SIZE,
  Shadows,
  Spacing,
  TAB_BAR_HEIGHT,
} from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";
import type { HomeScreenNavigationProp } from "@/types/navigation";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const scanningActions = getActionsByGroup("scanning");

export function ScanFAB() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const [menuOpen, setMenuOpen] = useState(false);

  // Hide FAB when navigated into a child screen (e.g. GroceryLists has its own FAB)
  const isOnRootScreen = useNavigationState((state) => {
    const focusedTab = state.routes[state.index];
    const nestedState = focusedTab.state;
    if (!nestedState) return true;
    return nestedState.index === 0;
  });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rotation.value}deg` }],
  }));

  const handlePressIn = () => {
    if (!reducedMotion) {
      scale.value = withSpring(0.9, pressSpringConfig);
    }
  };

  const handlePressOut = () => {
    if (!reducedMotion) {
      scale.value = withSpring(1, pressSpringConfig);
    }
  };

  const handlePress = () => {
    if (menuOpen) {
      closeMenu();
    } else {
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      setMenuOpen(true);
      if (!reducedMotion) {
        rotation.value = withSpring(45, pressSpringConfig);
      }
    }
  };

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    if (!reducedMotion) {
      rotation.value = withSpring(0, pressSpringConfig);
    }
  }, [reducedMotion, rotation]);

  const speedDialActions = useMemo(
    () =>
      scanningActions.map((action) => ({
        icon: action.icon,
        label: action.label,
        onPress: () => {
          closeMenu();
          haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
          navigateAction(action, navigation);
        },
      })),
    [closeMenu, haptics, navigation],
  );

  if (!isOnRootScreen) return null;

  return (
    <>
      {menuOpen && <SpeedDial actions={speedDialActions} onClose={closeMenu} />}
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={menuOpen ? "Close scan menu" : "Open scan menu"}
        style={[
          styles.fab,
          Shadows.large,
          animatedStyle,
          {
            backgroundColor: theme.link,
            bottom: TAB_BAR_HEIGHT + Spacing.lg,
          },
        ]}
      >
        <Feather name="plus" size={28} color={theme.buttonText} />
      </AnimatedPressable>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: Spacing.xl,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
});
