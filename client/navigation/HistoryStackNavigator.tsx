import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import HistoryScreen from "@/screens/HistoryScreen";
import ItemDetailScreen from "@/screens/ItemDetailScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useScreenOptions } from "@/hooks/useScreenOptions";

export type HistoryStackParamList = {
  History: { showAll?: boolean } | undefined;
  ItemDetail: { itemId: number };
};

const Stack = createNativeStackNavigator<HistoryStackParamList>();

export default function HistoryStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={{
          headerTitle: () => <HeaderTitle title="Today" />,
        }}
      />
      <Stack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={{
          headerTitle: () => <HeaderTitle title="Item Details" />,
        }}
      />
    </Stack.Navigator>
  );
}
