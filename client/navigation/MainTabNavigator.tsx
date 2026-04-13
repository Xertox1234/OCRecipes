import React, { useEffect } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import type { NavigatorScreenParams } from "@react-navigation/native";

import HomeStackNavigator from "@/navigation/HomeStackNavigator";
import MealPlanStackNavigator from "@/navigation/MealPlanStackNavigator";
import ChatStackNavigator from "@/navigation/ChatStackNavigator";
import ProfileStackNavigator from "@/navigation/ProfileStackNavigator";
import { ScanFAB } from "@/components/ScanFAB";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  FontFamily,
  TAB_BAR_HEIGHT,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import { tabIconPopConfig } from "@/constants/animations";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { ChatStackParamList } from "@/navigation/ChatStackNavigator";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";

export type MainTabParamList = {
  HomeTab: undefined;
  MealPlanTab: NavigatorScreenParams<MealPlanStackParamList> | undefined;
  CoachTab: NavigatorScreenParams<ChatStackParamList> | undefined;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

/** Animated wrapper for tab bar icons — pulses on focus change */
function AnimatedTabIcon({
  name,
  color,
  size,
  focused,
}: {
  name: keyof typeof Feather.glyphMap;
  color: string;
  size: number;
  focused: boolean;
}) {
  const { reducedMotion } = useAccessibility();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (focused && !reducedMotion) {
      scale.value = withSequence(
        withSpring(1.18, tabIconPopConfig),
        withDelay(100, withSpring(1, tabIconPopConfig)),
      );
    } else {
      scale.value = 1;
    }
  }, [focused, reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Feather name={name} size={size} color={color} />
    </Animated.View>
  );
}

export default function MainTabNavigator() {
  const { theme, isDark } = useTheme();
  const { reducedMotion } = useAccessibility();

  return (
    <View style={styles.container}>
      <Tab.Navigator
        initialRouteName="HomeTab"
        screenOptions={{
          // Cross-fade between tabs instead of instant swap
          animation: reducedMotion ? "none" : "fade",
          tabBarActiveTintColor: theme.link,
          tabBarInactiveTintColor: theme.tabIconDefault,
          tabBarStyle: {
            position: "absolute",
            backgroundColor: Platform.select({
              ios: "transparent",
              android: theme.backgroundSecondary,
            }),
            borderTopWidth: 0,
            elevation: 0,
            height: TAB_BAR_HEIGHT,
            // Shadow for elevated appearance (Figma design)
            shadowColor: "#000", // hardcoded — shadow color is always black
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.08,
            shadowRadius: 6,
          },
          tabBarBackground: () =>
            Platform.OS === "ios" ? (
              <BlurView
                intensity={isDark ? 60 : 80}
                tint={isDark ? "dark" : "light"}
                style={StyleSheet.absoluteFill}
              />
            ) : null,
          headerShown: false,
          tabBarLabel: ({ color, children }) => (
            <ThemedText
              maxScale={MAX_FONT_SCALE_CONSTRAINED}
              style={{
                fontFamily: FontFamily.medium,
                fontSize: 11,
                letterSpacing: 0.3,
                color,
              }}
            >
              {children}
            </ThemedText>
          ),
        }}
      >
        <Tab.Screen
          name="HomeTab"
          component={HomeStackNavigator}
          options={{
            title: "Home",
            tabBarIcon: ({ color, size, focused }) => (
              <AnimatedTabIcon
                name="home"
                size={size}
                color={color}
                focused={focused}
              />
            ),
          }}
        />
        <Tab.Screen
          name="MealPlanTab"
          component={MealPlanStackNavigator}
          options={{
            title: "Plan",
            tabBarIcon: ({ color, size, focused }) => (
              <AnimatedTabIcon
                name="calendar"
                size={size}
                color={color}
                focused={focused}
              />
            ),
          }}
        />
        <Tab.Screen
          name="CoachTab"
          component={ChatStackNavigator}
          options={{
            title: "Coach",
            tabBarIcon: ({ color, size, focused }) => (
              <AnimatedTabIcon
                name="message-circle"
                size={size}
                color={color}
                focused={focused}
              />
            ),
          }}
        />
        <Tab.Screen
          name="ProfileTab"
          component={ProfileStackNavigator}
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size, focused }) => (
              <AnimatedTabIcon
                name="user"
                size={size}
                color={color}
                focused={focused}
              />
            ),
          }}
        />
      </Tab.Navigator>
      <ScanFAB />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
