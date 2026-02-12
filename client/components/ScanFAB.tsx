import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
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
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.9, pressSpringConfig);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, pressSpringConfig);
  };

  const handlePress = () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate("Scan");
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel="Scan food item"
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
  },
});
