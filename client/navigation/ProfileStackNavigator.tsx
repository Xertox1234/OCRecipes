import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import ProfileScreen from "@/screens/ProfileScreen";
import SettingsScreen from "@/screens/SettingsScreen";
import SavedItemsScreen from "@/screens/SavedItemsScreen";
import HistoryScreen from "@/screens/HistoryScreen";
import ItemDetailScreen from "@/screens/ItemDetailScreen";
import HealthKitSettingsScreen from "@/screens/HealthKitSettingsScreen";
import GLP1CompanionScreen from "@/screens/GLP1CompanionScreen";
import FavouriteRecipesScreen from "@/screens/FavouriteRecipesScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type ProfileStackParamList = {
  Profile: undefined;
  Settings: undefined;
  SavedItems: undefined;
  ScanHistory: { showAll?: boolean } | undefined;
  ItemDetail: { itemId: number };
  HealthKitSettings: undefined;
  GLP1Companion: undefined;
  FavouriteRecipes: undefined;
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
        name="HealthKitSettings"
        component={HealthKitSettingsScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Apple Health" showIcon={false} />
          ),
        }}
      />
      <Stack.Screen
        name="GLP1Companion"
        component={GLP1CompanionScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="GLP-1 Companion" showIcon={false} />
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
    </Stack.Navigator>
  );
}
