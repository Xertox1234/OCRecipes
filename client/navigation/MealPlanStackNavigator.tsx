import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MealPlanHomeScreen from "@/screens/meal-plan/MealPlanHomeScreen";
import RecipeDetailScreen from "@/screens/meal-plan/RecipeDetailScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type MealPlanStackParamList = {
  MealPlanHome: undefined;
  RecipeDetail: { recipeId: number };
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
    </Stack.Navigator>
  );
}
