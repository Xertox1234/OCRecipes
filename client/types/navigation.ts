import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

// Import the param lists for use in composite types
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";
import type { HomeStackParamList } from "@/navigation/HomeStackNavigator";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import type { ChatStackParamList } from "@/navigation/ChatStackNavigator";

// Re-export types from navigation files for convenience
export type { RootStackParamList } from "@/navigation/RootStackNavigator";
export type { MainTabParamList } from "@/navigation/MainTabNavigator";
export type { HomeStackParamList } from "@/navigation/HomeStackNavigator";
export type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
export type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
export type { ChatStackParamList } from "@/navigation/ChatStackNavigator";

/**
 * 3-level composite: ChatStack → MainTab → RootStack.
 * Allows CoachChat to navigate to root-level modal screens
 * (FeaturedRecipeDetail, RecipeBrowserModal, etc.).
 */
export type CoachChatNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ChatStackParamList, "CoachPro">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList, "CoachTab">,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for HistoryScreen when hosted in ProfileStack as "ScanHistory".
 * Uses CompositeNavigationProp to navigate across stacks:
 * - Navigate within ProfileStack (ItemDetail, back to Profile)
 * - Navigate to other tabs (MealPlanTab)
 * - Navigate to RootStack screens (Scan modal)
 */
export type ScanHistoryNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, "ScanHistory">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for HomeScreen
 * Uses CompositeNavigationProp to navigate across stacks:
 * - Navigate within HomeStack
 * - Navigate to other tabs (MainTab)
 * - Navigate to RootStack screens (FeaturedRecipeDetail modal)
 */
export type HomeScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, "Home">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for ProfileScreen and SettingsScreen.
 * 3-level composite: ProfileStack → MainTab → RootStack.
 * Allows navigating to other tabs (HomeTab, MealPlanTab) and root-level modals.
 */
export type ProfileScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, "Profile">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList, "ProfileTab">,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for ScanScreen
 * Now a RootStack modal — can navigate to NutritionDetail, goBack, etc.
 */
export type ScanScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Scan"
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
 * Navigation prop for RecipeChatScreen
 * Can use goBack or navigate within RootStack
 */
export type RecipeChatScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "RecipeChat"
>;

/**
 * Navigation prop for MealPlanHomeScreen
 * Uses CompositeNavigationProp to navigate across stacks:
 * - Navigate within MealPlanStack
 * - Navigate to other tabs (MainTab)
 * - Navigate to RootStack screens (FeaturedRecipeDetail modal)
 */
export type MealPlanHomeScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<MealPlanStackParamList, "MealPlanHome">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for RecipeBrowserScreen
 * Uses CompositeNavigationProp to navigate across stacks:
 * - Navigate within MealPlanStack (RecipeDetail, RecipeCreate, etc.)
 * - Navigate to other tabs (MainTab)
 * - Navigate to RootStack screens (FeaturedRecipeDetail modal)
 */
export type RecipeBrowserScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<MealPlanStackParamList, "RecipeBrowser">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
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
export type RecipeImportScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<MealPlanStackParamList, "RecipeImport">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for RecipePhotoImportScreen
 * Can navigate within meal plan stack
 */
export type RecipePhotoImportScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "RecipePhotoImport"
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

/**
 * Navigation prop for CookbookCreateScreen
 * Can navigate within meal plan stack
 */
export type CookbookCreateScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "CookbookCreate"
>;

/**
 * Navigation prop for CookbookListScreen
 * Can navigate within meal plan stack
 */
export type CookbookListScreenNavigationProp = NativeStackNavigationProp<
  MealPlanStackParamList,
  "CookbookList"
>;

/**
 * Navigation prop for FavouriteRecipesScreen.
 * Screen is registered in both MealPlanStack and ProfileStack.
 * Uses MealPlanStack & ProfileStack intersection so the inner type
 * covers both hosting contexts. The outer composite chain
 * (MainTab → RootStack) is identical for both stacks.
 */
export type FavouriteRecipesScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<
    MealPlanStackParamList & ProfileStackParamList,
    "FavouriteRecipes"
  >,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for CookbookDetailScreen
 * Uses CompositeNavigationProp to navigate across stacks:
 * - Navigate within MealPlanStack (RecipeDetail, CookbookEdit)
 * - Navigate to other tabs (MainTab)
 * - Navigate to RootStack screens (FeaturedRecipeDetail modal for community recipes)
 */
export type CookbookDetailScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<MealPlanStackParamList, "CookbookDetail">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

/**
 * Navigation prop for MenuScanResultScreen
 * Can use goBack or navigate within RootStack
 */
export type MenuScanResultScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "MenuScanResult"
>;

/**
 * Navigation prop for AllConversationsScreen
 * Can use goBack or navigate within RootStack
 */
export type AllConversationsNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "AllConversations"
>;

/**
 * Navigation prop for NotebookScreen
 * Can use goBack or navigate within RootStack
 */
export type NotebookScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "NotebookScreen"
>;

/**
 * Navigation prop for NotebookEntryScreen
 * Can use goBack or navigate within RootStack
 */
export type NotebookEntryNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "NotebookEntry"
>;
