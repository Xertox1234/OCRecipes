import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

// Import the param lists for use in composite types
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";
import type { HistoryStackParamList } from "@/navigation/HistoryStackNavigator";
import type { ScanStackParamList } from "@/navigation/ScanStackNavigator";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

// Re-export types from navigation files for convenience
export type { RootStackParamList } from "@/navigation/RootStackNavigator";
export type { MainTabParamList } from "@/navigation/MainTabNavigator";
export type { HistoryStackParamList } from "@/navigation/HistoryStackNavigator";
export type { ScanStackParamList } from "@/navigation/ScanStackNavigator";
export type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

/**
 * Navigation prop for HistoryScreen
 * Can navigate to ItemDetail within the history stack
 */
export type HistoryScreenNavigationProp = NativeStackNavigationProp<
  HistoryStackParamList,
  "History"
>;

/**
 * Navigation prop for HistoryScreen (Today dashboard).
 * Uses CompositeNavigationProp to navigate across stacks:
 * - Navigate within HistoryStack (ItemDetail)
 * - Navigate to ScanTab (MainTab - for quick scan CTA)
 */
export type TodayDashboardNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HistoryStackParamList, "History">,
  BottomTabNavigationProp<MainTabParamList>
>;

/**
 * Navigation prop for ScanScreen
 * Uses CompositeNavigationProp to navigate across stacks:
 * - Navigate to NutritionDetail (RootStack)
 * - Navigate to HistoryTab (MainTab)
 */
export type ScanScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ScanStackParamList, "Scan">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for NutritionDetailScreen
 * Can use goBack or navigate within RootStack
 */
export type NutritionDetailScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "NutritionDetail"
>;

/**
 * Navigation prop for PhotoIntentScreen
 * Can use goBack or navigate within RootStack
 */
export type PhotoIntentScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "PhotoIntent"
>;

/**
 * Navigation prop for PhotoAnalysisScreen
 * Can use goBack or navigate within RootStack
 */
export type PhotoAnalysisScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "PhotoAnalysis"
>;

/**
 * Navigation prop for GoalSetupScreen
 * Can use goBack or navigate within RootStack
 */
export type GoalSetupScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "GoalSetup"
>;

/**
 * Navigation prop for FeaturedRecipeDetailScreen
 * Can use goBack or navigate within RootStack
 */
export type FeaturedRecipeDetailScreenNavigationProp =
  NativeStackNavigationProp<RootStackParamList, "FeaturedRecipeDetail">;

/**
 * Navigation prop for MealPlanHomeScreen
 * Can navigate within meal plan stack and to other tabs
 */
export type MealPlanHomeScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<MealPlanStackParamList, "MealPlanHome">,
  BottomTabNavigationProp<MainTabParamList>
>;

/**
 * Navigation prop for RecipeDetailScreen
 * Can navigate within meal plan stack
 */
export type RecipeDetailScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeDetail"
>;

/**
 * Navigation prop for RecipeBrowserScreen
 * Can navigate within meal plan stack
 */
export type RecipeBrowserScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeBrowser"
>;

/**
 * Navigation prop for RecipeCreateScreen
 * Can navigate within meal plan stack
 */
export type RecipeCreateScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeCreate"
>;

/**
 * Navigation prop for RecipeImportScreen
 * Can navigate within meal plan stack
 */
export type RecipeImportScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipeImport"
>;

/**
 * Navigation prop for GroceryListsScreen
 * Can navigate within meal plan stack
 */
export type GroceryListsScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "GroceryLists"
>;

/**
 * Navigation prop for GroceryListScreen
 * Can navigate within meal plan stack
 */
export type GroceryListScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "GroceryList"
>;
