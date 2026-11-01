import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import { LABELLED_INPUT_TEXT } from "@/components/field-focus-utils";
import {
  resolvePlaceholder,
  shouldFloatLabel,
} from "@/components/text-input-utils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/context/ToastContext";
import { usePremiumContext } from "@/context/PremiumContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import {
  useChatConversations,
  useDeleteConversation,
  usePinConversation,
  type ChatConversation,
} from "@/hooks/useChat";
import {
  REFRESH_ON_FOCUS_SETTLE_MS,
  useRefreshOnFocus,
} from "@/hooks/useRefreshOnFocus";
import { ThemedText } from "@/components/ThemedText";
import { EmptyState, OfflineEmptyState } from "@/components/EmptyState";
import { isPausedWithoutData } from "@/components/empty-state-utils";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { AllConversationsNavigationProp } from "@/types/navigation";
import { safeGoBack } from "@/navigation/safeGoBack";

const MAX_PINNED = 3;

const SEARCH_LABEL = "Search conversations";
const SEARCH_ICON_SIZE = 16;
// The search bar's text starts past its left padding, the icon and the gap.
const SEARCH_LABEL_LEFT = Spacing.sm + SEARCH_ICON_SIZE + Spacing.xs;

type ChatSegment = "coach" | "recipe";

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function AllConversationsScreen() {
  const { theme } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<AllConversationsNavigationProp>();

  const { isLoading: isPremiumLoading } = usePremiumContext();
  const isCoachPro = usePremiumFeature("coachPro");
  const showCoachPro = isCoachPro || isPremiumLoading;

  const [activeSegment, setActiveSegment] = useState<ChatSegment>("coach");
  const [search, setSearch] = useState("");
  const searchFocus = useFieldFocus();
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: conversations = [],
    isLoading,
    isError,
    fetchStatus,
    refetch,
  } = useChatConversations(activeSegment, {
    search: debouncedSearch || undefined,
  });
  // This screen can stay mounted under a pushed chat screen (Chat, RecipeChat).
  // A reply that finishes after the user left marks the conversation list
  // stale with `refetchType: "none"` (#1060/#1065) — that only refetches once
  // a query observer mounts, so pick it up on refocus instead of waiting for
  // a manual pull-to-refresh. `refetch` is stable across `activeSegment`
  // switches (react-query keeps the same observer instance for this
  // component's lifetime — see ChatListScreen.tsx), so whichever tab is
  // active when the screen refocuses is the one that gets refreshed.
  const refetchOnFocus = useCallback(() => {
    void refetch();
  }, [refetch]);
  // settleMs: the refocus usually lands in the same transition as the abort
  // that invalidated the coach list with `refetchType: "none"` — re-read once
  // the server's post-disconnect write has settled (see the constant's
  // comment). Sized for the coach path only; the recipe-tab generation path
  // is a known, pre-existing residual (documented on the constant).
  useRefreshOnFocus(refetchOnFocus, { settleMs: REFRESH_ON_FOCUS_SETTLE_MS });
  const pinConversation = usePinConversation();
  const deleteConversation = useDeleteConversation();

  const { pinned, unpinned } = useMemo(
    () => ({
      pinned: conversations.filter((c) => c.isPinned),
      unpinned: conversations.filter((c) => !c.isPinned),
    }),
    [conversations],
  );

  const handleTogglePin = useCallback(
    async (conv: ChatConversation) => {
      const pinnedCount = conversations.filter((c) => c.isPinned).length;
      if (!conv.isPinned && pinnedCount >= MAX_PINNED) {
        Alert.alert(
          "Pin limit reached",
          "Unpin an existing conversation first.",
        );
        return;
      }
      try {
        await pinConversation.mutateAsync({
          id: conv.id,
          isPinned: !conv.isPinned,
        });
      } catch {
        toast.error(
          conv.isPinned
            ? "Couldn't unpin the conversation. Please try again."
            : "Couldn't pin the conversation. Please try again.",
        );
      }
    },
    [conversations, pinConversation, toast],
  );

  const handleDelete = useCallback(
    (conv: ChatConversation) => {
      Alert.alert("Delete conversation", `Delete "${conv.title}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            deleteConversation.mutate(conv.id, {
              onError: () =>
                toast.error(
                  "Couldn't delete the conversation. Please try again.",
                ),
            }),
        },
      ]);
    },
    [deleteConversation, toast],
  );

  const renderRow = useCallback(
    (conv: ChatConversation) => (
      <Pressable
        key={conv.id}
        style={[styles.row, { borderBottomColor: theme.border }]}
        onPress={() => {
          if (activeSegment === "recipe") {
            navigation.navigate("RecipeChat", { conversationId: conv.id });
          } else {
            // This is a root-stack screen; CoachPro lives only in the Coach
            // tab's nested ChatStack. A bare navigate("CoachPro") is never
            // handled (navigationInChildEnabled is off), so name the path.
            // `pop: true` returns to the EXISTING Main route below this modal;
            // without it the root StackRouter pushes a second Main on top.
            // Free-tier rows open the plain Chat screen (as ChatListScreen
            // does). While premium status loads, keep CoachPro so a Coach Pro
            // user is never routed to Chat (CoachProScreen assumes access
            // while loading too).
            navigation.navigate(
              "Main",
              {
                screen: "CoachTab",
                params: showCoachPro
                  ? {
                      screen: "CoachPro",
                      params: { selectedConversationId: conv.id },
                    }
                  : {
                      screen: "Chat",
                      params: { conversationId: conv.id },
                      pop: true,
                    },
              },
              { pop: true },
            );
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open conversation: ${conv.title}`}
      >
        <View style={styles.rowContent}>
          <ThemedText type="small" numberOfLines={1} style={styles.rowTitle}>
            {conv.title ||
              (activeSegment === "recipe"
                ? "Recipe chat"
                : "Coach conversation")}
          </ThemedText>
          <ThemedText
            type="caption"
            style={[styles.rowMeta, { color: theme.textSecondary }]}
          >
            {formatRelativeDate(conv.updatedAt)}
          </ThemedText>
        </View>
        <View style={styles.rowActions}>
          <Pressable
            onPress={() => handleTogglePin(conv)}
            style={styles.rowAction}
            accessibilityRole="button"
            accessibilityLabel={
              conv.isPinned ? "Unpin conversation" : "Pin conversation"
            }
          >
            <Feather
              name="bookmark"
              size={18}
              color={conv.isPinned ? theme.link : theme.textSecondary}
              accessible={false}
            />
          </Pressable>
          <Pressable
            onPress={() => handleDelete(conv)}
            style={styles.rowAction}
            accessibilityRole="button"
            accessibilityLabel="Delete conversation"
          >
            <Feather
              name="trash-2"
              size={18}
              color={theme.textSecondary}
              accessible={false}
            />
          </Pressable>
        </View>
      </Pressable>
    ),
    [
      activeSegment,
      handleDelete,
      handleTogglePin,
      navigation,
      showCoachPro,
      theme,
    ],
  );

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.container,
        { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <ThemedText type="h4" style={styles.headerTitle}>
          All Conversations
        </ThemedText>
        <Pressable
          onPress={() =>
            safeGoBack(navigation, () =>
              navigation.reset({
                index: 0,
                routes: [{ name: "Main", params: { screen: "CoachTab" } }],
              }),
            )
          }
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Feather name="x" size={24} color={theme.text} accessible={false} />
        </Pressable>
      </View>

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
              onPress={() => setActiveSegment(segment)}
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
                style={{
                  color: isActive ? theme.text : theme.textSecondary,
                  fontFamily: isActive
                    ? FontFamily.semiBold
                    : FontFamily.regular,
                }}
              >
                {segment === "coach" ? "Coach" : "Recipes"}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <FocusField
        focus={searchFocus}
        label={SEARCH_LABEL}
        hasValue={search.length > 0}
        labelLeft={SEARCH_LABEL_LEFT}
        style={[
          styles.searchBar,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <Feather
          name="search"
          size={SEARCH_ICON_SIZE}
          color={theme.textSecondary}
          accessible={false}
        />
        <FocusTextInput
          focusRing={false}
          onFocus={searchFocus.onFocus}
          onBlur={searchFocus.onBlur}
          style={[styles.searchInput, { color: theme.text }]}
          // The label rests where the placeholder would; it shows once floated.
          placeholder={resolvePlaceholder(
            SEARCH_LABEL,
            "e.g. meal prep",
            shouldFloatLabel(searchFocus.focused, search),
          )}
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          accessibilityLabel={SEARCH_LABEL}
        />
      </FocusField>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} color={theme.link} />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {pinned.length > 0 && (
            <>
              <ThemedText
                type="caption"
                style={[styles.sectionLabel, { color: theme.link }]}
              >
                PINNED
              </ThemedText>
              {pinned.map(renderRow)}
            </>
          )}
          {unpinned.length > 0 && (
            <>
              <ThemedText
                type="caption"
                style={[styles.sectionLabel, { color: theme.textSecondary }]}
              >
                CONVERSATIONS
              </ThemedText>
              {unpinned.map(renderRow)}
            </>
          )}
          {isError && conversations.length === 0 ? (
            <EmptyState
              variant="temporary"
              icon="alert-circle"
              title="Couldn't load your conversations"
              description="Something went wrong. Tap below to try again."
              actionLabel="Try Again"
              onAction={() => {
                void refetch();
              }}
            />
          ) : isPausedWithoutData(fetchStatus, conversations.length > 0) ? (
            <OfflineEmptyState what="conversations" />
          ) : (
            conversations.length === 0 && (
              <ThemedText
                type="small"
                style={[styles.empty, { color: theme.textSecondary }]}
              >
                No conversations found
              </ThemedText>
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {},
  segmentContainer: {
    flexDirection: "row",
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.sm,
    padding: 3,
  },
  segmentTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    margin: Spacing.md,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  // Labelled field: the value sits under the floated label's row.
  searchInput: {
    flex: 1,
    fontSize: 14,
    ...LABELLED_INPUT_TEXT,
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowContent: { flex: 1 },
  rowTitle: { fontFamily: FontFamily.medium },
  rowMeta: { marginTop: 2 },
  rowAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  rowActions: { flexDirection: "row", alignItems: "center" },
  listContent: {},
  loading: { marginTop: Spacing.xl },
  empty: { textAlign: "center", marginTop: Spacing.xl },
});
