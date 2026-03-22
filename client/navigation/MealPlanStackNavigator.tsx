import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MealPlanHomeScreen from "@/screens/meal-plan/MealPlanHomeScreen";
import RecipeDetailScreen from "@/screens/meal-plan/RecipeDetailScreen";
import RecipeBrowserScreen from "@/screens/meal-plan/RecipeBrowserScreen";
import RecipeCreateScreen from "@/screens/meal-plan/RecipeCreateScreen";
import RecipeImportScreen from "@/screens/meal-plan/RecipeImportScreen";
import RecipePhotoImportScreen from "@/screens/meal-plan/RecipePhotoImportScreen";
import GroceryListsScreen from "@/screens/meal-plan/GroceryListsScreen";
import GroceryListScreen from "@/screens/meal-plan/GroceryListScreen";
import PantryScreen from "@/screens/meal-plan/PantryScreen";
import CookbookCreateScreen from "@/screens/meal-plan/CookbookCreateScreen";
import CookbookListScreen from "@/screens/meal-plan/CookbookListScreen";
import CookbookDetailScreen from "@/screens/meal-plan/CookbookDetailScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import type { ImportedRecipeData } from "@shared/types/recipe-import";

export type MealPlanStackParamList = {
  MealPlanHome: undefined;
  RecipeDetail: { recipeId: number };
  RecipeBrowser: {
    mealType?: string;
    plannedDate?: string;
    searchQuery?: string;
  };
  RecipeCreate: {
    prefill?: ImportedRecipeData;
    returnToMealPlan?: { mealType: string; plannedDate: string };
  };
  RecipeImport:
    | { returnToMealPlan?: { mealType: string; plannedDate: string } }
    | undefined;
  RecipePhotoImport: {
    photoUri: string;
    returnToMealPlan?: { mealType: string; plannedDate: string };
  };
  GroceryLists: undefined;
  GroceryList: { listId: number };
  Pantry: undefined;
  CookbookCreate: { cookbookId?: number } | undefined;
  CookbookList: undefined;
  CookbookDetail: { cookbookId: number };
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
        name="RecipeDetail"
        component={RecipeDetailScreen}
        options={{
          headerTitle: () => <HeaderTitle title="Recipe" showIcon={false} />,
        }}
      />
      <Stack.Screen
        name="RecipeBrowser"
        component={RecipeBrowserScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Add Recipe" showIcon={false} />
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
        name="RecipePhotoImport"
        component={RecipePhotoImportScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Import Recipe" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="GroceryLists"
        component={GroceryListsScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Grocery Lists" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="GroceryList"
        component={GroceryListScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Grocery List" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="Pantry"
        component={PantryScreen}
        options={{
          headerTitle: () => <HeaderTitle title="Pantry" showIcon={false} />,
        }}
      />
      <Stack.Screen
        name="CookbookList"
        component={CookbookListScreen}
        options={{
          headerTitle: () => <HeaderTitle title="Cookbooks" showIcon={false} />,
        }}
      />
      <Stack.Screen
        name="CookbookDetail"
        component={CookbookDetailScreen}
        options={{
          headerTitle: () => <HeaderTitle title="Cookbook" showIcon={false} />,
        }}
      />
      <Stack.Screen
        name="CookbookCreate"
        component={CookbookCreateScreen}
        options={({ route }) => ({
          headerTitle: () => (
            <HeaderTitle
              title={
                route.params?.cookbookId ? "Edit Cookbook" : "New Cookbook"
              }
              showIcon={false}
            />
          ),
        })}
      />
    </Stack.Navigator>
  );
}
