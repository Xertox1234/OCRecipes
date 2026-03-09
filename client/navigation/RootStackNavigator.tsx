import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View, StyleSheet } from "react-native";

import MainTabNavigator from "@/navigation/MainTabNavigator";
import LoginScreen from "@/screens/LoginScreen";
import ScanScreen from "@/screens/ScanScreen";
import NutritionDetailScreen from "@/screens/NutritionDetailScreen";
import PhotoIntentScreen from "@/screens/PhotoIntentScreen";
import PhotoAnalysisScreen from "@/screens/PhotoAnalysisScreen";
import GoalSetupScreen from "@/screens/GoalSetupScreen";
import EditDietaryProfileScreen from "@/screens/EditDietaryProfileScreen";
import FeaturedRecipeDetailScreen from "@/screens/FeaturedRecipeDetailScreen";
import QuickLogScreen from "@/screens/QuickLogScreen";
import MenuScanResultScreen from "@/screens/MenuScanResultScreen";
import LabelAnalysisScreen from "@/screens/LabelAnalysisScreen";
import ReceiptCaptureScreen from "@/screens/ReceiptCaptureScreen";
import ReceiptReviewScreen from "@/screens/ReceiptReviewScreen";
import CookSessionCaptureScreen from "@/screens/CookSessionCaptureScreen";
import CookSessionReviewScreen from "@/screens/CookSessionReviewScreen";
import SubstitutionResultScreen from "@/screens/SubstitutionResultScreen";
import OnboardingNavigator from "@/navigation/OnboardingNavigator";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useAuthContext } from "@/context/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import type { PhotoIntent } from "@shared/constants/preparation";
import type { MenuAnalysisItem } from "@/hooks/useMenuScan";
import type {
  CookingSessionIngredient,
  SubstitutionResult,
} from "@shared/types/cook-session";

export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  Main: undefined;
  Scan: { mode?: "label" } | undefined;
  LabelAnalysis: { imageUri: string; barcode?: string };
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
  FeaturedRecipeDetail: { recipeId: number };
  QuickLog: undefined;
  MenuScanResult: {
    items: MenuAnalysisItem[];
    restaurantName?: string;
    cuisine?: string;
  };
  ReceiptCapture: undefined;
  ReceiptReview: { photoUris: string[] };
  CookSessionCapture: { initialPhotoUri?: string };
  CookSessionReview: {
    sessionId: string;
    ingredients: CookingSessionIngredient[];
  };
  SubstitutionResult: {
    sessionId: string;
    result: SubstitutionResult;
    ingredients: CookingSessionIngredient[];
  };
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
            name="Scan"
            component={ScanScreen}
            options={{
              headerShown: false,
              // fullScreenModal intentional — transparentModal had rendering issues
              presentation: "fullScreenModal",
              animation: "slide_from_bottom",
            }}
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
          <Stack.Screen
            name="FeaturedRecipeDetail"
            component={FeaturedRecipeDetailScreen}
            options={{
              headerShown: false,
              presentation: "transparentModal",
              animation: "slide_from_bottom",
            }}
          />
          <Stack.Screen
            name="QuickLog"
            component={QuickLogScreen}
            options={{
              headerTitle: "Quick Log",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="MenuScanResult"
            component={MenuScanResultScreen}
            options={{
              headerTitle: "Menu Analysis",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="LabelAnalysis"
            component={LabelAnalysisScreen}
            options={{
              headerTitle: "Label Analysis",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="ReceiptCapture"
            component={ReceiptCaptureScreen}
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: "slide_from_bottom",
            }}
          />
          <Stack.Screen
            name="ReceiptReview"
            component={ReceiptReviewScreen}
            options={{
              headerTitle: "Review Items",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="CookSessionCapture"
            component={CookSessionCaptureScreen}
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: "slide_from_bottom",
            }}
          />
          <Stack.Screen
            name="CookSessionReview"
            component={CookSessionReviewScreen}
            options={{
              headerTitle: "Review Ingredients",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="SubstitutionResult"
            component={SubstitutionResultScreen}
            options={{
              headerTitle: "Substitution Suggestions",
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
