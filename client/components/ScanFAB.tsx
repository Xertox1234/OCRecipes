import React, { useState, useCallback, useMemo } from "react";
import { Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { SpeedDial } from "@/components/SpeedDial";
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
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function ScanFAB() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const scale = useSharedValue(1);
  const rotation = useSharedValue(0);
  const [speedDialOpen, setSpeedDialOpen] = useState(false);

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
    if (speedDialOpen) {
      closeSpeedDial();
    } else {
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      navigation.navigate("Scan");
    }
  };

  const handleLongPress = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Heavy);
    setSpeedDialOpen(true);
    if (!reducedMotion) {
      rotation.value = withSpring(45, pressSpringConfig);
    }
  };

  const closeSpeedDial = useCallback(() => {
    setSpeedDialOpen(false);
    if (!reducedMotion) {
      rotation.value = withSpring(0, pressSpringConfig);
    }
  }, [reducedMotion, rotation]);

  const speedDialActions = useMemo(
    () => [
      {
        icon: "camera",
        label: "Camera Scan",
        onPress: () => {
          closeSpeedDial();
          haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
          navigation.navigate("Scan");
        },
      },
      {
        icon: "edit-3",
        label: "Quick Log",
        onPress: () => {
          closeSpeedDial();
          haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
          navigation.navigate("QuickLog");
        },
      },
    ],
    [closeSpeedDial, haptics, navigation],
  );

  return (
    <>
      {speedDialOpen && (
        <SpeedDial actions={speedDialActions} onClose={closeSpeedDial} />
      )}
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={handleLongPress}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={
          speedDialOpen
            ? "Close quick actions"
            : "Scan food item. Long press for more options."
        }
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
