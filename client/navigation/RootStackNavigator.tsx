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
import DailyNutritionDetailScreen from "@/screens/DailyNutritionDetailScreen";
import MenuScanResultScreen from "@/screens/MenuScanResultScreen";
import LabelAnalysisScreen from "@/screens/LabelAnalysisScreen";
import ReceiptCaptureScreen from "@/screens/ReceiptCaptureScreen";
import ReceiptReviewScreen from "@/screens/ReceiptReviewScreen";
import CookSessionCaptureScreen from "@/screens/CookSessionCaptureScreen";
import CookSessionReviewScreen from "@/screens/CookSessionReviewScreen";
import SubstitutionResultScreen from "@/screens/SubstitutionResultScreen";
import ReceiptMealPlanScreen from "@/screens/meal-plan/ReceiptMealPlanScreen";
import OnboardingNavigator from "@/navigation/OnboardingNavigator";
import { HeaderTitle } from "@/components/HeaderTitle";
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
import type { FrontLabelExtractionResult } from "@shared/types/front-label";
import FrontLabelConfirmScreen from "@/screens/FrontLabelConfirmScreen";
import BatchScanScreen from "@/screens/BatchScanScreen";
import BatchSummaryScreen from "@/screens/BatchSummaryScreen";
import WeightTrackingScreen from "@/screens/WeightTrackingScreen";
import CoachChatScreen from "@/screens/CoachChatScreen";

export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  Main: undefined;
  Scan: { mode?: "label" | "front-label"; verifyBarcode?: string } | undefined;
  LabelAnalysis: {
    imageUri: string;
    barcode?: string;
    verificationMode?: boolean;
    verifyBarcode?: string;
  };
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
  FeaturedRecipeDetail: {
    recipeId: number;
    /** "community" (default) fetches from /api/recipes/:id; "mealPlan" fetches from /api/meal-plan/recipes/:id */
    recipeType?: "community" | "mealPlan";
    /** When provided, the screen uses this data directly instead of fetching by ID */
    carouselCard?: import("@shared/types/carousel").CarouselRecipeCard;
  };
  QuickLog: undefined;
  DailyNutritionDetail: undefined;
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
  ReceiptMealPlan: {
    startDate?: string;
  };
  FrontLabelConfirm: {
    imageUri: string;
    barcode: string;
    sessionId: string;
    data: FrontLabelExtractionResult;
  };
  BatchScan: undefined;
  BatchSummary: undefined;
  WeightTracking: undefined;
  CoachChat: {
    question: string;
    questionText: string;
    screenContext?: string;
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
              presentation: "modal",
              animation: "slide_from_bottom",
              gestureEnabled: true,
              fullScreenGestureEnabled: true,
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
            name="DailyNutritionDetail"
            component={DailyNutritionDetailScreen}
            options={{
              headerTitle: "Today's Nutrition",
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
          <Stack.Screen
            name="ReceiptMealPlan"
            component={ReceiptMealPlanScreen}
            options={{
              headerTitle: "Plan Meals",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="FrontLabelConfirm"
            component={FrontLabelConfirmScreen}
            options={{
              headerTitle: "Product Details",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="BatchScan"
            component={BatchScanScreen}
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: "slide_from_bottom",
            }}
          />
          <Stack.Screen
            name="BatchSummary"
            component={BatchSummaryScreen}
            options={{
              headerTitle: "Batch Summary",
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="WeightTracking"
            component={WeightTrackingScreen}
            options={{
              headerTitle: () => (
                <HeaderTitle title="Weight Tracking" showIcon={false} />
              ),
              presentation: "modal",
            }}
          />
          <Stack.Screen
            name="CoachChat"
            component={CoachChatScreen}
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: "slide_from_bottom",
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
