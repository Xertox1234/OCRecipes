import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import ProfileScreen from "@/screens/ProfileScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import SavedItemsScreen from "@/screens/SavedItemsScreen";
import HistoryScreen from "@/screens/HistoryScreen";
import ItemDetailScreen from "@/screens/ItemDetailScreen";
import FavouriteRecipesScreen from "@/screens/FavouriteRecipesScreen";
import CoachRemindersScreen from "@/screens/CoachRemindersScreen";
import TasteProfileScreen from "@/screens/TasteProfileScreen";
import GroceryListsScreen from "@/screens/meal-plan/GroceryListsScreen";
import GroceryListScreen from "@/screens/meal-plan/GroceryListScreen";
import PantryScreen from "@/screens/meal-plan/PantryScreen";
import CookbookListScreen from "@/screens/meal-plan/CookbookListScreen";
import CookbookDetailScreen from "@/screens/meal-plan/CookbookDetailScreen";
import CookbookCreateScreen from "@/screens/meal-plan/CookbookCreateScreen";
import RecipeBrowserScreen from "@/screens/meal-plan/RecipeBrowserScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";

// The Profile library tiles open these Plan-stack screens INSIDE the Profile
// stack (like FavouriteRecipes), not as root modals: a root-modal copy can't
// reach their Plan-stack-only detail routes (a bare navigate never descends
// into a sibling tab's stack — the tap is silently dropped) and its confirm
// sheet opens behind the native modal. Every route these screens navigate to
// must be registered here or in an ancestor — enforced by
// scripts/__tests__/navigation-route-reachability.test.ts.
type LibraryRoutes = Pick<
  MealPlanStackParamList,
  | "GroceryLists"
  | "GroceryList"
  | "Pantry"
  | "CookbookList"
  | "CookbookDetail"
  | "CookbookCreate"
  | "RecipeBrowser"
>;

export type ProfileStackParamList = LibraryRoutes & {
  Profile: undefined;
  Settings: undefined;
  SavedItems: undefined;
  ScanHistory: { showAll?: boolean } | undefined;
  ItemDetail: { itemId: number };
  FavouriteRecipes: undefined;
  CoachReminders: undefined;
  TasteProfile: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerTitle: () => <HeaderTitle title="Settings" showIcon={false} />,
        }}
      />
      <Stack.Screen
        name="SavedItems"
        component={SavedItemsScreen}
        options={{
          headerTitle: () => <HeaderTitle title="My Library" />,
        }}
      />
      <Stack.Screen
        name="ScanHistory"
        component={HistoryScreen}
        initialParams={{ showAll: true }}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Scan History" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Item Details" showIcon={false} />
          ),
        }}
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
      <Stack.Screen
        name="CoachReminders"
        component={CoachRemindersScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Coach Reminders" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="TasteProfile"
        component={TasteProfileScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Taste Profile" showIcon={false} />
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
      <Stack.Screen
        name="RecipeBrowser"
        component={RecipeBrowserScreen}
        initialParams={{}}
        options={{
          headerTitle: () => <HeaderTitle title="Recipes" showIcon={false} />,
        }}
      />
    </Stack.Navigator>
  );
}
