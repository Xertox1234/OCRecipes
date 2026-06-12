import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
  const { isPremiumResolved, isError, refreshSubscription } =
    usePremiumContext();
  const isCoachPro = usePremiumFeature("coachPro");
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const safeAreaStyle = {
    backgroundColor: theme.backgroundDefault,
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
  };

  // Don't mount the navigator until premium status is genuinely resolved —
  // initialRouteName is evaluated only once at mount time, so rendering with
  // the default free-tier value (coachPro: false) would permanently route Pro
  // users to ChatList for the session.
  //
  // We gate on isPremiumResolved (subscriptionData !== undefined) rather than
  // !isLoading, because a hard query error leaves isLoading=false while
  // features still default to free — causing the same lock-in bug. The error
  // branch below lets users manually retry; automatic recovery happens when
  // the app goes offline→online (NetInfo wires refetchOnReconnect).
  if (isError && !isPremiumResolved) {
    return (
      <View style={[styles.loadingContainer, safeAreaStyle]}>
        <Text style={[styles.errorText, { color: theme.textSecondary }]}>
          Could not load your subscription status.
        </Text>
        <Pressable
          onPress={refreshSubscription}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Retry loading Coach"
        >
          <Text style={[styles.retryText, { color: theme.link }]}>
            Tap to retry
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!isPremiumResolved) {
    return (
      <View style={[styles.loadingContainer, safeAreaStyle]}>
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
  errorText: {
    fontSize: 15,
    marginBottom: 12,
    textAlign: "center",
  },
  retryText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
