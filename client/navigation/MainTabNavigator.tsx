import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";

import HistoryStackNavigator from "@/navigation/HistoryStackNavigator";
import MealPlanStackNavigator from "@/navigation/MealPlanStackNavigator";
import ScanStackNavigator from "@/navigation/ScanStackNavigator";
import ProfileStackNavigator from "@/navigation/ProfileStackNavigator";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";

export type MainTabParamList = {
  HistoryTab: undefined;
  MealPlanTab: undefined;
  ScanTab: undefined;
  ProfileTab: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const { theme, isDark } = useTheme();

  return (
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
          height: Platform.select({
            ios: 88,
            android: 72,
          }),
          paddingTop: Spacing.sm,
          // Shadow for elevated appearance (Figma design)
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.04,
          shadowRadius: 4,
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
          fontSize: 10,
          letterSpacing: 0.1,
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
        name="ScanTab"
        component={ScanStackNavigator}
        options={{
          title: "Scan",
          tabBarStyle: { display: "none" },
          tabBarIcon: ({ color, focused }) => (
            <View
              style={[
                styles.scanIconContainer,
                {
                  backgroundColor: focused
                    ? theme.link
                    : theme.backgroundSecondary,
                },
              ]}
            >
              <Feather
                name="camera"
                size={24}
                color={focused ? theme.buttonText : color}
              />
            </View>
          ),
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: "Scan food barcode or nutrition label",
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
  );
}

const styles = StyleSheet.create({
  scanIconContainer: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing["2xl"],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
