import React from "react";
import { View, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OnboardingProvider, useOnboarding } from "@/context/OnboardingContext";
import { OnboardingProgressBar } from "@/components/OnboardingProgressBar";
import { useTheme } from "@/hooks/useTheme";
import WelcomeScreen from "@/screens/onboarding/WelcomeScreen";
import AllergiesScreen from "@/screens/onboarding/AllergiesScreen";
import HealthConditionsScreen from "@/screens/onboarding/HealthConditionsScreen";
import DietTypeScreen from "@/screens/onboarding/DietTypeScreen";
import GoalsScreen from "@/screens/onboarding/GoalsScreen";
import PreferencesScreen from "@/screens/onboarding/PreferencesScreen";

export type OnboardingStackParamList = {
  Welcome: undefined;
  Allergies: undefined;
  HealthConditions: undefined;
  DietType: undefined;
  Goals: undefined;
  Preferences: undefined;
};

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

const SCREENS = [
  { name: "Welcome" as const, component: WelcomeScreen },
  { name: "Allergies" as const, component: AllergiesScreen },
  { name: "HealthConditions" as const, component: HealthConditionsScreen },
  { name: "DietType" as const, component: DietTypeScreen },
  { name: "Goals" as const, component: GoalsScreen },
  { name: "Preferences" as const, component: PreferencesScreen },
];

function OnboardingStack() {
  const { currentStep, totalSteps } = useOnboarding();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const currentScreen = SCREENS[currentStep];

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.backgroundRoot,
          paddingTop: insets.top,
        },
      ]}
    >
      <OnboardingProgressBar
        currentStep={currentStep}
        totalSteps={totalSteps}
      />
      <View style={styles.content}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
            gestureEnabled: false,
          }}
        >
          <Stack.Screen
            name={currentScreen.name}
            component={currentScreen.component}
          />
        </Stack.Navigator>
      </View>
    </View>
  );
}

export default function OnboardingNavigator() {
  return (
    <OnboardingProvider>
      <OnboardingStack />
    </OnboardingProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
