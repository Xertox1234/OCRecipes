import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { OnboardingProvider, useOnboarding } from "@/context/OnboardingContext";
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
  const { currentStep } = useOnboarding();
  const currentScreen = SCREENS[currentStep];

  return (
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
  );
}

export default function OnboardingNavigator() {
  return (
    <OnboardingProvider>
      <OnboardingStack />
    </OnboardingProvider>
  );
}
