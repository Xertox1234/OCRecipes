import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, Pressable, View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";

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
import { useAccessibility } from "@/hooks/useAccessibility";
import { Colors } from "@/constants/theme";
import type { PhotoIntent } from "@shared/constants/preparation";
import type {
  CookingSessionIngredient,
  SubstitutionResult,
} from "@shared/types/cook-session";
import type { FrontLabelExtractionResult } from "@shared/types/front-label";
import type { MealPlanDay } from "@shared/types/meal-plan";
import FrontLabelConfirmScreen from "@/screens/FrontLabelConfirmScreen";
import BatchScanScreen from "@/screens/BatchScanScreen";
import BatchSummaryScreen from "@/screens/BatchSummaryScreen";
import WeightTrackingScreen from "@/screens/WeightTrackingScreen";
import CoachChatScreen from "@/screens/CoachChatScreen";
import RecipeChatScreen from "@/screens/RecipeChatScreen";
import CookbookListScreen from "@/screens/meal-plan/CookbookListScreen";
import GroceryListsScreen from "@/screens/meal-plan/GroceryListsScreen";
import PantryScreen from "@/screens/meal-plan/PantryScreen";
import RecipeBrowserScreen from "@/screens/meal-plan/RecipeBrowserScreen";
import FastingScreen from "@/screens/FastingScreen";
import AllConversationsScreen from "@/screens/AllConversationsScreen";
import NotebookScreen from "@/screens/NotebookScreen";
import NotebookEntryScreen from "@/screens/NotebookEntryScreen";

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
    /** Raw OCR text from frame processor for instant local parsing */
    localOCRText?: string;
  };
  NutritionDetail: {
    barcode?: string;
    imageUri?: string;
    itemId?: number;
    nutritionImageUri?: string;
    frontLabelImageUri?: string;
    localOCRText?: string;
  };
  PhotoIntent:
    | {
        imageUri: string;
      }
    | undefined;
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
    /** Deep link query param — alias for recipeType */
    type?: "community" | "mealPlan";
  };
  QuickLog: undefined;
  DailyNutritionDetail: undefined;
  MenuScanResult: {
    imageUri: string;
    localOCRText?: string;
  };
  ReceiptCapture: undefined;
  ReceiptReview: { photoUris: string[]; ocrTexts?: string[] };
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
    sessionId: string | null;
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
  RecipeChat: {
    conversationId?: number;
    initialMessage?: string;
    /** When set, RecipeChatScreen enters remix mode for this recipe. */
    remixSourceRecipeId?: number;
    remixSourceRecipeTitle?: string;
  };
  // Profile hub modal screens (back returns to Profile, not Plan tab)
  CookbookListModal: undefined;
  GroceryListsModal: undefined;
  PantryModal: undefined;
  RecipeBrowserModal:
    | {
        mealType?: string;
        date?: string;
        planDays?: MealPlanDay[];
      }
    | undefined;
  FastingModal: undefined;
  AllConversations: { onSelect: (id: number) => void };
  NotebookScreen: undefined;
  NotebookEntry: { entryId?: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();
  const { isAuthenticated, isLoading, user } = useAuthContext();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

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
              // fade_from_bottom gives a scale-up + fade effect, reinforcing
              // spatial continuity from the FAB position
              animation: reducedMotion ? "none" : "fade_from_bottom",
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
              // Cross-fade from PhotoIntent reinforces the "processing" transition
              animation: reducedMotion ? "none" : "fade",
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
              animation: reducedMotion ? "none" : "slide_from_bottom",
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
              animation: reducedMotion ? "none" : "slide_from_bottom",
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
              animation: reducedMotion ? "none" : "slide_from_bottom",
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
              animation: reducedMotion ? "none" : "slide_from_bottom",
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
              animation: reducedMotion ? "none" : "slide_from_bottom",
            }}
          />
          <Stack.Screen
            name="RecipeChat"
            component={RecipeChatScreen}
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: reducedMotion ? "none" : "slide_from_bottom",
            }}
          />

          {/* Profile hub modals — back returns to Profile, not Plan tab */}
          <Stack.Screen
            name="CookbookListModal"
            component={CookbookListScreen}
            options={({ navigation }) => ({
              headerTitle: () => (
                <HeaderTitle title="Cookbooks" showIcon={false} />
              ),
              presentation: "modal",
              headerLeft: () => (
                <Pressable
                  onPress={() => navigation.goBack()}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Feather name="x" size={24} color={theme.text} />
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="GroceryListsModal"
            component={GroceryListsScreen}
            options={({ navigation }) => ({
              headerTitle: () => (
                <HeaderTitle title="Grocery Lists" showIcon={false} />
              ),
              presentation: "modal",
              headerLeft: () => (
                <Pressable
                  onPress={() => navigation.goBack()}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Feather name="x" size={24} color={theme.text} />
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="PantryModal"
            component={PantryScreen}
            options={({ navigation }) => ({
              headerTitle: () => (
                <HeaderTitle title="Pantry" showIcon={false} />
              ),
              presentation: "modal",
              headerLeft: () => (
                <Pressable
                  onPress={() => navigation.goBack()}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Feather name="x" size={24} color={theme.text} />
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="RecipeBrowserModal"
            component={RecipeBrowserScreen}
            options={({ navigation }) => ({
              headerTitle: () => (
                <HeaderTitle title="Recipes" showIcon={false} />
              ),
              presentation: "modal",
              headerLeft: () => (
                <Pressable
                  onPress={() => navigation.goBack()}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Feather name="x" size={24} color={theme.text} />
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="FastingModal"
            component={FastingScreen}
            options={({ navigation }) => ({
              headerTitle: () => (
                <HeaderTitle title="Fasting Timer" showIcon={false} />
              ),
              presentation: "modal",
              headerLeft: () => (
                <Pressable
                  onPress={() => navigation.goBack()}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Feather name="x" size={24} color={theme.text} />
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="AllConversations"
            component={AllConversationsScreen}
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: reducedMotion ? "none" : "slide_from_bottom",
            }}
          />
          <Stack.Screen
            name="NotebookScreen"
            component={NotebookScreen}
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: reducedMotion ? "none" : "slide_from_bottom",
            }}
          />
          <Stack.Screen
            name="NotebookEntry"
            component={NotebookEntryScreen}
            options={{
              headerShown: false,
              presentation: "fullScreenModal",
              animation: reducedMotion ? "none" : "slide_from_bottom",
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
