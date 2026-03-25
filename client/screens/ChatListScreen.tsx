import React, { useCallback } from "react";
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
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ChatStackParamList } from "@/navigation/ChatStackNavigator";

type ChatListNavigationProp = NativeStackNavigationProp<
  ChatStackParamList,
  "ChatList"
>;

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

  const {
    data: conversations,
    isLoading,
    refetch,
    isRefetching,
  } = useChatConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();

  const handleNewChat = useCallback(async () => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
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
  }, [haptics, toast, createConversation, navigation]);

  const handleOpenChat = useCallback(
    (conversationId: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("Chat", { conversationId });
    },
    [haptics, navigation],
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
          reducedMotion ? undefined : FadeInDown.delay(index * 50).duration(300)
        }
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
          accessibilityHint="Long press to delete"
        >
          <View
            style={[
              styles.chatIcon,
              { backgroundColor: withOpacity(theme.link, 0.12) },
            ]}
          >
            <Feather
              name="message-circle"
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
      </Animated.View>
    ),
    [handleOpenChat, handleDeleteChat, theme, reducedMotion],
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

      <FlatList
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
