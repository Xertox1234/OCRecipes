import React, { useCallback, useEffect, useState } from "react";
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
import { usePendingReminders } from "@/hooks/usePendingReminders";
import {
  FontFamily,
  TAB_BAR_HEIGHT,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import { tabIconPopConfig } from "@/constants/animations";
import { getTabContentA11y } from "@/navigation/MainTabNavigator-utils";
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
  const { hasPending } = usePendingReminders();
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <View style={styles.container}>
      {/* `Tab.Navigator` has no prop that reaches `importantForAccessibility` (verified
          against @react-navigation/bottom-tabs' createBottomTabNavigator.d.ts / types.d.ts —
          `screenOptions.sceneStyle` exists but is scene-scoped, ViewStyle-typed, and
          doesn't cover the tab bar this pattern also needs hidden), so some View must
          carry it to mirror ScanFAB/SpeedDial's iOS `accessibilityViewIsModal` trap on
          Android (SpeedDial mounts as a SIBLING of this whole Tab.Navigator, not
          inside it). This wrapper is paint-safe: it's non-positioned with no
          zIndex and doesn't reparent ScanFAB (still a same-level sibling
          below), so it can't flip paint order the way merging multiple
          zIndex'd siblings under one new wrapper would. */}
      <View
        testID="tab-content-a11y-wrapper"
        style={styles.tabContent}
        importantForAccessibility={getTabContentA11y(menuOpen)}
      >
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
              // The custom tabBarLabel render fn suppresses bottom-tabs' derived
              // accessibilityLabel, leaving Android to expose an aggregated
              // ", Home"-style label — set both handles explicitly (E2E flows
              // tap tabs by these testIDs). Keep tabBarAccessibilityLabel in
              // lockstep with title on every tab: voice-control users speak
              // the visible label (WCAG 2.5.3 Label in Name).
              tabBarAccessibilityLabel: "Home",
              tabBarButtonTestID: "tab-home",
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
              tabBarAccessibilityLabel: "Plan",
              tabBarButtonTestID: "tab-plan",
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
              tabBarAccessibilityLabel: "Coach",
              tabBarButtonTestID: "tab-coach",
              tabBarIcon: ({ color, size, focused }) => (
                <View style={styles.iconWrapper}>
                  <AnimatedTabIcon
                    name="message-circle"
                    size={size}
                    color={color}
                    focused={focused}
                  />
                  {hasPending && (
                    <View
                      style={[
                        styles.dot,
                        { borderColor: theme.backgroundDefault },
                      ]}
                    />
                  )}
                </View>
              ),
            }}
          />
          <Tab.Screen
            name="ProfileTab"
            component={ProfileStackNavigator}
            options={{
              title: "Profile",
              tabBarAccessibilityLabel: "Profile",
              tabBarButtonTestID: "tab-profile",
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
      </View>
      <ScanFAB menuOpen={menuOpen} onOpen={openMenu} onClose={closeMenu} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabContent: {
    flex: 1,
  },
  iconWrapper: {
    position: "relative",
  },
  dot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#EF4444", // hardcoded — badge red is always red-500
    borderWidth: 2,
  },
});
