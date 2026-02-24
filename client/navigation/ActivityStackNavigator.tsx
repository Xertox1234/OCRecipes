import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ExerciseLogScreen from "@/screens/ExerciseLogScreen";
import ExerciseSearchScreen from "@/screens/ExerciseSearchScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type ActivityStackParamList = {
  ExerciseLog: undefined;
  ExerciseSearch: {
    onSelect?: (exercise: {
      name: string;
      type: string;
      metValue: string;
    }) => void;
  };
};

const Stack = createNativeStackNavigator<ActivityStackParamList>();

export default function ActivityStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="ExerciseLog"
        component={ExerciseLogScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="ExerciseSearch"
        component={ExerciseSearchScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Find Exercise" showIcon={false} />
          ),
        }}
      />
    </Stack.Navigator>
  );
}
