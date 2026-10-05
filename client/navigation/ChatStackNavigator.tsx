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
import { getChatRouteId } from "@/navigation/chatRouteId";
import CoachProScreen from "@/screens/CoachProScreen";
import FavouriteRecipesScreen from "@/screens/FavouriteRecipesScreen";
import GroceryListsScreen from "@/screens/meal-plan/GroceryListsScreen";
import GroceryListScreen from "@/screens/meal-plan/GroceryListScreen";
import PantryScreen from "@/screens/meal-plan/PantryScreen";
import CookbookListScreen from "@/screens/meal-plan/CookbookListScreen";
import CookbookDetailScreen from "@/screens/meal-plan/CookbookDetailScreen";
import CookbookCreateScreen from "@/screens/meal-plan/CookbookCreateScreen";
import RecipeBrowserScreen from "@/screens/meal-plan/RecipeBrowserScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { usePremiumContext } from "@/context/PremiumContext";
import { useTheme } from "@/hooks/useTheme";
import { coachInitialRoute } from "./coachInitialRoute";
import type { MealPlanStackParamList } from "./MealPlanStackNavigator";

// The Coach's links (CoachChat, hosted by CoachPro) open these Plan-stack
// screens INSIDE the Coach stack, the same way the Profile library tiles do
// (see ProfileStackNavigator): a root-modal copy can't reach their
// Plan-stack-only detail routes, so tapping a list or cookbook was silently
// dropped. Every route these screens navigate to must be registered here or
// in an ancestor — enforced by
// scripts/__tests__/navigation-route-reachability.test.ts.
type LibraryRoutes = Pick<
  MealPlanStackParamList,
  | "GroceryLists"
  | "GroceryList"
  | "Pantry"
  | "CookbookList"
  | "CookbookDetail"
  | "CookbookCreate"
  | "FavouriteRecipes"
  | "RecipeBrowser"
>;

export type ChatStackParamList = LibraryRoutes & {
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
      initialRouteName={coachInitialRoute(isCoachPro)}
    >
      <Stack.Screen
        name="ChatList"
        component={ChatListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        getId={getChatRouteId}
        options={{ headerTitle: "NutriCoach" }}
      />
      <Stack.Screen
        name="CoachPro"
        component={CoachProScreen}
        options={{ headerShown: false }}
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
        name="FavouriteRecipes"
        component={FavouriteRecipesScreen}
        options={{
          headerTitle: () => (
            <HeaderTitle title="Favourites" showIcon={false} />
          ),
        }}
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
