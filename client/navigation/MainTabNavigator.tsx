import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";

import HistoryStackNavigator from "@/navigation/HistoryStackNavigator";
import MealPlanStackNavigator from "@/navigation/MealPlanStackNavigator";
import ProfileStackNavigator from "@/navigation/ProfileStackNavigator";
import { ScanFAB } from "@/components/ScanFAB";
import { useTheme } from "@/hooks/useTheme";
import { FontFamily, TAB_BAR_HEIGHT } from "@/constants/theme";

export type MainTabParamList = {
  HistoryTab: undefined;
  MealPlanTab: undefined;
  ProfileTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <View style={styles.container}>
      <Tab.Navigator
        initialRouteName="HistoryTab"
        screenOptions={{
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
          tabBarLabelStyle: {
            fontFamily: FontFamily.medium,
            fontSize: 11,
            letterSpacing: 0.3,
          },
        }}
      >
        <Tab.Screen
          name="HistoryTab"
          component={HistoryStackNavigator}
          options={{
            title: "Today",
            tabBarIcon: ({ color, size }) => (
              <Feather name="clock" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="MealPlanTab"
          component={MealPlanStackNavigator}
          options={{
            title: "Plan",
            tabBarIcon: ({ color, size }) => (
              <Feather name="calendar" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="ProfileTab"
          component={ProfileStackNavigator}
          options={{
            title: "Profile",
            tabBarIcon: ({ color, size }) => (
              <Feather name="user" size={size} color={color} />
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
