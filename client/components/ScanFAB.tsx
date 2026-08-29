import React, { useCallback, useEffect, useMemo } from "react";
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

interface ScanFABProps {
  /** Owned by MainTabNavigator — it also drives the Android a11y trap on the
   *  tab content behind the menu (see MainTabNavigator-utils.ts), so ScanFAB
   *  no longer owns this state itself. */
  menuOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export function ScanFAB({ menuOpen, onOpen, onClose }: ScanFABProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);

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
      onOpen();
      if (!reducedMotion) {
        rotation.value = withSpring(45, pressSpringConfig);
      }
    }
  };

  const closeMenu = useCallback(() => {
    onClose();
    if (!reducedMotion) {
      rotation.value = withSpring(0, pressSpringConfig);
    }
  }, [onClose, reducedMotion, rotation]);

  // Force-close the menu when navigation moves off the root screen while
  // it's still open (e.g. a deep link into a nested screen — `CoachTab` >
  // `Chat`, `MealPlanTab` > `GroceryLists` — bypassing SpeedDial's own
  // close-then-navigate action handlers). `isOnRootScreen` going false does
  // NOT unmount ScanFAB — it only makes it `return null` below, so a plain
  // unmount-cleanup effect never fires here. `menuOpen` lives in
  // MainTabNavigator (which does not unmount with the FAB), so without this
  // effect an orphaned `menuOpen: true` would leave every tab + the tab bar
  // permanently hidden from the Android a11y tree with no FAB/SpeedDial left
  // to close it.
  useEffect(() => {
    if (!isOnRootScreen && menuOpen) {
      closeMenu();
    }
  }, [isOnRootScreen, menuOpen, closeMenu]);

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
            backgroundColor: theme.accentSolid,
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
