import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ChatListScreen from "@/screens/ChatListScreen";
import ChatScreen from "@/screens/ChatScreen";
import CoachProScreen from "@/screens/CoachProScreen";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { usePremiumContext } from "@/context/PremiumContext";
import { useTheme } from "@/hooks/useTheme";

export type ChatStackParamList = {
  ChatList: undefined;
  Chat: { conversationId: number } | { initialMessage: string } | undefined;
  CoachPro: { selectedConversationId?: number } | undefined;
};

const Stack = createNativeStackNavigator<ChatStackParamList>();

export default function ChatStackNavigator() {
  const screenOptions = useScreenOptions();
  const { isLoading: isPremiumLoading } = usePremiumContext();
  const isCoachPro = usePremiumFeature("coachPro");
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  // Don't mount the navigator until premium status is resolved — initialRouteName
  // is only evaluated once at mount time, so rendering with the default free-tier
  // value (coachPro: false) would permanently route Pro users to ChatList.
  if (isPremiumLoading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          {
            backgroundColor: theme.backgroundDefault,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}
      >
        <ActivityIndicator size="large" color={theme.textSecondary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={screenOptions}
      initialRouteName={isCoachPro ? "CoachPro" : "ChatList"}
    >
      <Stack.Screen
        name="ChatList"
        component={ChatListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ headerTitle: "NutriCoach" }}
      />
      <Stack.Screen
        name="CoachPro"
        component={CoachProScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
