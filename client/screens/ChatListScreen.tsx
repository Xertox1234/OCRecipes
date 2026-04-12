import React, { useCallback, useState } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { SwipeableRow } from "@/components/SwipeableRow";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  useChatConversations,
  useCreateConversation,
  useDeleteConversation,
  type ChatConversation,
} from "@/hooks/useChat";
import {
  Spacing,
  FontFamily,
  BorderRadius,
  FAB_CLEARANCE,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { ChatStackParamList } from "@/navigation/ChatStackNavigator";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type ChatListNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ChatStackParamList, "ChatList">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;

type ChatSegment = "coach" | "recipe";

const MAX_ANIMATED_INDEX = 10;

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function ChatListScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { reducedMotion } = useAccessibility();
  const { confirm, ConfirmationModal } = useConfirmationModal();
  const navigation = useNavigation<ChatListNavigationProp>();

  const [activeSegment, setActiveSegment] = useState<ChatSegment>("coach");
  const isRecipeMode = activeSegment === "recipe";

  const {
    data: conversations,
    isLoading,
    refetch,
    isRefetching,
  } = useChatConversations(activeSegment);
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();

  const handleNewChat = useCallback(async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);

    // Recipe chats open the dedicated RecipeChat screen
    if (isRecipeMode) {
      navigation.navigate("RecipeChat", {});
      return;
    }

    try {
      const conversation = await createConversation.mutateAsync(undefined);
      navigation.navigate("Chat", { conversationId: conversation.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      let userMessage: string;
      if (msg.startsWith("401:")) {
        userMessage = "Session expired. Please log in again.";
      } else if (msg.startsWith("429:")) {
        userMessage = "Too many requests. Please wait a moment.";
      } else if (msg.includes("Network") || msg.includes("fetch")) {
        userMessage = "Unable to reach server. Check your connection.";
      } else {
        userMessage = "Could not create conversation. Please try again.";
      }
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error(userMessage);
    }
  }, [haptics, toast, createConversation, navigation, isRecipeMode]);

  const handleOpenChat = useCallback(
    (conversationId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      if (isRecipeMode) {
        navigation.navigate("RecipeChat", { conversationId });
      } else {
        navigation.navigate("Chat", { conversationId });
      }
    },
    [haptics, navigation, isRecipeMode],
  );

  const handleDeleteChat = useCallback(
    (id: number, title: string) => {
      confirm({
        title: "Delete Chat",
        message: `Delete "${title}"?`,
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => deleteConversation.mutate(id),
      });
    },
    [confirm, deleteConversation],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ChatConversation; index: number }) => (
      <Animated.View
        entering={
          reducedMotion
            ? undefined
            : FadeInDown.delay(
                Math.min(index, MAX_ANIMATED_INDEX) * 50,
              ).duration(300)
        }
      >
        <SwipeableRow
          rightAction={{
            icon: "trash-2",
            label: "Delete",
            backgroundColor: theme.error,
            onAction: () => handleDeleteChat(item.id, item.title),
          }}
        >
          <Pressable
            onPress={() => handleOpenChat(item.id)}
            onLongPress={() => handleDeleteChat(item.id, item.title)}
            delayLongPress={500}
            style={({ pressed }) => [
              styles.conversationItem,
              {
                backgroundColor: pressed
                  ? withOpacity(theme.text, 0.04)
                  : "transparent",
                borderBottomColor: theme.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Chat: ${item.title}. ${formatRelativeTime(item.updatedAt)}`}
            accessibilityHint="Swipe left to delete, or long press"
          >
            <View
              style={[
                styles.chatIcon,
                { backgroundColor: withOpacity(theme.link, 0.12) },
              ]}
            >
              <Feather
                name={isRecipeMode ? "book-open" : "message-circle"}
                size={18}
                color={theme.link}
                accessible={false}
              />
            </View>
            <View style={styles.conversationContent}>
              <ThemedText
                type="body"
                style={styles.conversationTitle}
                numberOfLines={1}
              >
                {item.title}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {formatRelativeTime(item.updatedAt)}
              </ThemedText>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={theme.textSecondary}
              accessible={false}
            />
          </Pressable>
        </SwipeableRow>
      </Animated.View>
    ),
    [handleOpenChat, handleDeleteChat, theme, reducedMotion, isRecipeMode],
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + Spacing.lg,
          },
        ]}
      >
        <View>
          <ThemedText type="h4" style={styles.headerTitle}>
            NutriCoach
          </ThemedText>
          <ThemedText
            type="small"
            style={[styles.headerSubtitle, { color: theme.textSecondary }]}
          >
            Your personal nutrition assistant
          </ThemedText>
        </View>
        <Pressable
          onPress={handleNewChat}
          style={[styles.newChatButton, { backgroundColor: theme.link }]}
          accessibilityRole="button"
          accessibilityLabel="Start new chat"
          disabled={createConversation.isPending}
        >
          <Feather name="plus" size={20} color={theme.buttonText} />
        </Pressable>
      </View>

      {/* Segment Control */}
      <View
        style={[
          styles.segmentContainer,
          { backgroundColor: withOpacity(theme.text, 0.06) },
        ]}
        accessibilityRole="tablist"
      >
        {(["coach", "recipe"] as const).map((segment) => {
          const isActive = activeSegment === segment;
          return (
            <Pressable
              key={segment}
              onPress={() => {
                setActiveSegment(segment);
                haptics.impact(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={[
                styles.segmentTab,
                isActive && [
                  styles.segmentTabActive,
                  { backgroundColor: theme.backgroundRoot },
                ],
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={
                segment === "coach" ? "Coach chats" : "Recipe chats"
              }
            >
              <ThemedText
                type="caption"
                style={[
                  styles.segmentLabel,
                  {
                    color: isActive ? theme.text : theme.textSecondary,
                    fontWeight: isActive ? "600" : "400",
                  },
                ]}
              >
                {segment === "coach" ? "Coach" : "Recipes"}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        {...FLATLIST_DEFAULTS}
        data={conversations}
        renderItem={renderItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={{
          paddingBottom: tabBarHeight + FAB_CLEARANCE,
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch().then(() => haptics.impact())}
            tintColor={theme.link}
          />
        }
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.emptyContainer}>
              <View
                style={[
                  styles.emptyIcon,
                  { backgroundColor: withOpacity(theme.link, 0.1) },
                ]}
              >
                <Feather name="message-circle" size={40} color={theme.link} />
              </View>
              <ThemedText type="h4" style={styles.emptyTitle}>
                Start a Conversation
              </ThemedText>
              <ThemedText
                type="body"
                style={[styles.emptyText, { color: theme.textSecondary }]}
              >
                Ask NutriCoach for personalized nutrition advice, meal
                suggestions, and help reaching your goals.
              </ThemedText>
              <Pressable
                onPress={handleNewChat}
                style={[styles.emptyButton, { backgroundColor: theme.link }]}
                accessibilityRole="button"
                accessibilityLabel="Start your first chat"
                disabled={createConversation.isPending}
              >
                <Feather name="plus" size={18} color={theme.buttonText} />
                <ThemedText
                  type="body"
                  style={[styles.emptyButtonText, { color: theme.buttonText }]}
                >
                  New Chat
                </ThemedText>
              </Pressable>
            </View>
          )
        }
      />
      <ConfirmationModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  headerTitle: {
    fontFamily: FontFamily.bold,
  },
  headerSubtitle: {
    marginTop: 2,
  },
  segmentContainer: {
    flexDirection: "row",
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.sm,
    padding: 3,
  },
  segmentTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
  },
  segmentTabActive: {
    shadowColor: "#000", // hardcoded — iOS shadow requires literal black
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentLabel: {
    fontSize: 13,
  },
  newChatButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  conversationItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  chatIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  conversationContent: {
    flex: 1,
    gap: 2,
  },
  conversationTitle: {
    fontFamily: FontFamily.medium,
    fontSize: 15,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing["3xl"],
    paddingBottom: Spacing["5xl"],
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  emptyTitle: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  emptyText: {
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  emptyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.button,
  },
  emptyButtonText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
  },
});
