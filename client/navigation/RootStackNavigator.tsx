import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View, StyleSheet } from "react-native";

import MainTabNavigator from "@/navigation/MainTabNavigator";
import LoginScreen from "@/screens/LoginScreen";
import NutritionDetailScreen from "@/screens/NutritionDetailScreen";
import PhotoIntentScreen from "@/screens/PhotoIntentScreen";
import PhotoAnalysisScreen from "@/screens/PhotoAnalysisScreen";
import GoalSetupScreen from "@/screens/GoalSetupScreen";
import EditDietaryProfileScreen from "@/screens/EditDietaryProfileScreen";
import OnboardingNavigator from "@/navigation/OnboardingNavigator";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useAuthContext } from "@/context/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import type { PhotoIntent } from "@shared/constants/preparation";

export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  Main: undefined;
  NutritionDetail: {
    barcode?: string;
    imageUri?: string;
    itemId?: number;
  };
  PhotoIntent: {
    imageUri: string;
  };
  PhotoAnalysis: {
    imageUri: string;
    intent: PhotoIntent;
  };
  GoalSetup: undefined;
  EditDietaryProfile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();
  const { isAuthenticated, isLoading, user } = useAuthContext();
  const { theme } = useTheme();

  if (isLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator size="large" color={Colors.light.success} />
      </View>
    );
  }

  const needsOnboarding = isAuthenticated && !user?.onboardingCompleted;

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      {!isAuthenticated ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      ) : needsOnboarding ? (
        <Stack.Screen
          name="Onboarding"
          component={OnboardingNavigator}
          options={{ headerShown: false }}
        />
      ) : (
        <>
          <Stack.Screen
            name="Main"
            component={MainTabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="NutritionDetail"
            component={NutritionDetailScreen}
            options={{
              headerTitle: "Nutrition Facts",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="PhotoIntent"
            component={PhotoIntentScreen}
            options={{
              headerTitle: "What would you like to do?",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="PhotoAnalysis"
            component={PhotoAnalysisScreen}
            options={{
              headerTitle: "Meal Analysis",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="GoalSetup"
            component={GoalSetupScreen}
            options={{
              headerTitle: "Set Goals",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="EditDietaryProfile"
            component={EditDietaryProfileScreen}
            options={{
              headerTitle: "Edit Preferences",
              presentation: "modal",
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
