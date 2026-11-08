import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MealPlanHomeScreen from "@/screens/meal-plan/MealPlanHomeScreen";
import RecipeBrowserScreen from "@/screens/meal-plan/RecipeBrowserScreen";
import RecipeCreateScreen from "@/screens/meal-plan/RecipeCreateScreen";
import RecipeImportScreen from "@/screens/meal-plan/RecipeImportScreen";
import RecipeImportBrowserScreen from "@/screens/meal-plan/RecipeImportBrowserScreen";
import RecipePhotoImportScreen from "@/screens/meal-plan/RecipePhotoImportScreen";
import RecipeTextImportScreen from "@/screens/meal-plan/RecipeTextImportScreen";
import GroceryListsScreen from "@/screens/meal-plan/GroceryListsScreen";
import GroceryListScreen from "@/screens/meal-plan/GroceryListScreen";
import PantryScreen from "@/screens/meal-plan/PantryScreen";
import CookbookCreateScreen from "@/screens/meal-plan/CookbookCreateScreen";
import CookbookListScreen from "@/screens/meal-plan/CookbookListScreen";
import CookbookDetailScreen from "@/screens/meal-plan/CookbookDetailScreen";
import FavouriteRecipesScreen from "@/screens/FavouriteRecipesScreen";
import RecipeEntryHubScreen from "@/screens/meal-plan/RecipeEntryHubScreen";
import RecipeAIGenerateScreen from "@/screens/meal-plan/RecipeAIGenerateScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import {
  LIBRARY_SCREEN_OPTIONS,
  cookbookCreateOptions,
} from "@/navigation/library-screen-options";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import type { ImportedRecipeData } from "@shared/types/recipe-import";
import type { MealPlanDay } from "@shared/types/meal-plan";

export type MealPlanStackParamList = {
  MealPlanHome: undefined;
  RecipeBrowser: {
    mealType?: string;
    plannedDate?: string;
    searchQuery?: string;
    planDays?: MealPlanDay[];
  };
  RecipeEntryHub:
    | {
        returnToMealPlan?: { mealType: string; plannedDate: string };
        /** Tab the user jumped from (Profile/Coach stack browser) — Back returns there. */
        returnToTab?: "ProfileTab" | "CoachTab";
      }
    | undefined;
  RecipeAIGenerate:
    | { returnToMealPlan?: { mealType: string; plannedDate: string } }
    | undefined;
  RecipeCreate: {
    prefill?: ImportedRecipeData;
    returnToMealPlan?: { mealType: string; plannedDate: string };
    /** Set when this screen was reached (via RecipeImport/RecipePhotoImport) from Home — see useFromHomeBackRedirect. */
    fromHome?: boolean;
  };
  RecipeImport:
    | {
        returnToMealPlan?: { mealType: string; plannedDate: string };
        /** Set when navigated to directly from Home — see useFromHomeBackRedirect. */
        fromHome?: boolean;
      }
    | undefined;
  RecipeImportBrowser: {
    url: string;
    returnToMealPlan?: { mealType: string; plannedDate: string };
    fromHome?: boolean;
  };
  RecipePhotoImport: {
    photoUri: string;
    returnToMealPlan?: { mealType: string; plannedDate: string };
    /** Set when navigated to directly from Home — see useFromHomeBackRedirect. */
    fromHome?: boolean;
  };
  RecipeTextImport: {
    pastedText: string;
    returnToMealPlan?: { mealType: string; plannedDate: string };
    /** Set when navigated to directly from Home — see useFromHomeBackRedirect. */
    fromHome?: boolean;
  };
  GroceryLists: { fromHome?: boolean } | undefined;
  GroceryList: { listId: number };
  Pantry: { fromHome?: boolean } | undefined;
  CookbookCreate: { cookbookId?: number; fromHome?: boolean } | undefined;
  CookbookList: undefined;
  CookbookDetail: { cookbookId: number };
  FavouriteRecipes: undefined;
};

const Stack = createNativeStackNavigator<MealPlanStackParamList>();

export default function MealPlanStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="MealPlanHome"
        component={MealPlanHomeScreen}
        options={{
          headerTitle: () => <HeaderTitle title="Plan" />,
        }}
      />
      <Stack.Screen
        name="RecipeBrowser"
        component={RecipeBrowserScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Browse Recipes" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="RecipeEntryHub"
        component={RecipeEntryHubScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Add Recipe" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="RecipeAIGenerate"
        component={RecipeAIGenerateScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Generate with AI" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="RecipeCreate"
        component={RecipeCreateScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="New Recipe" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="RecipeImport"
        component={RecipeImportScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Import Recipe" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="RecipeImportBrowser"
        component={RecipeImportBrowserScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RecipePhotoImport"
        component={RecipePhotoImportScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Import Recipe" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="RecipeTextImport"
        component={RecipeTextImportScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Import Recipe" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="GroceryLists"
        component={GroceryListsScreen}
        options={LIBRARY_SCREEN_OPTIONS.GroceryLists}
      />
      <Stack.Screen
        name="GroceryList"
        component={GroceryListScreen}
        options={LIBRARY_SCREEN_OPTIONS.GroceryList}
      />
      <Stack.Screen
        name="Pantry"
        component={PantryScreen}
        options={LIBRARY_SCREEN_OPTIONS.Pantry}
      />
      <Stack.Screen
        name="CookbookList"
        component={CookbookListScreen}
        options={LIBRARY_SCREEN_OPTIONS.CookbookList}
      />
      <Stack.Screen
        name="CookbookDetail"
        component={CookbookDetailScreen}
        options={LIBRARY_SCREEN_OPTIONS.CookbookDetail}
      />
      <Stack.Screen
        name="CookbookCreate"
        component={CookbookCreateScreen}
        options={cookbookCreateOptions}
      />
      <Stack.Screen
        name="FavouriteRecipes"
        component={FavouriteRecipesScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Favourites" showIcon={false} />
          ),
        }}
      />
    </Stack.Navigator>
  );
}
