import React, { type ComponentType } from "react";
import { View, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OnboardingProvider, useOnboarding } from "@/context/OnboardingContext";
import {
  ONBOARDING_SCREENS,
  QUESTION_STEP_COUNT,
  getQuestionStep,
  type OnboardingScreenName,
} from "@/context/onboarding-steps";
import { OnboardingProgressBar } from "@/components/OnboardingProgressBar";
import { useTheme } from "@/hooks/useTheme";
import WelcomeScreen from "@/screens/onboarding/WelcomeScreen";
import HealthDataConsentScreen from "@/screens/onboarding/HealthDataConsentScreen";
import AllergiesScreen from "@/screens/onboarding/AllergiesScreen";
import HealthConditionsScreen from "@/screens/onboarding/HealthConditionsScreen";
import DietTypeScreen from "@/screens/onboarding/DietTypeScreen";
import GoalsScreen from "@/screens/onboarding/GoalsScreen";
import PreferencesScreen from "@/screens/onboarding/PreferencesScreen";
import TastePicksScreen from "@/screens/onboarding/TastePicksScreen";

export type OnboardingStackParamList = Record<OnboardingScreenName, undefined>;

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

// A Record over the screen names, so a name without a component (or a
// component without a name) fails to compile. Order comes from
// ONBOARDING_SCREENS, which the step counts derive from.
const SCREEN_COMPONENTS: Record<OnboardingScreenName, ComponentType> = {
  Welcome: WelcomeScreen,
  HealthDataConsent: HealthDataConsentScreen,
  Allergies: AllergiesScreen,
  HealthConditions: HealthConditionsScreen,
  DietType: DietTypeScreen,
  Goals: GoalsScreen,
  Preferences: PreferencesScreen,
  TastePicks: TastePicksScreen,
};

const SCREENS = ONBOARDING_SCREENS.map((name) => ({
  name,
  component: SCREEN_COMPONENTS[name],
}));

function OnboardingStack() {
  const { currentStep } = useOnboarding();
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
        currentStep={getQuestionStep(currentStep) - 1}
        totalSteps={QUESTION_STEP_COUNT}
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
