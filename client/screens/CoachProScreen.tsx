import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  AppState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { useCoachBrief } from "@/hooks/useCoachBrief";
import { usePendingReminders } from "@/hooks/usePendingReminders";
import {
  REFRESH_ON_FOCUS_SETTLE_MS,
  useRefreshOnFocus,
} from "@/hooks/useRefreshOnFocus";
import { useChatConversations, useCreateConversation } from "@/hooks/useChat";
import { useNotebookEntries } from "@/hooks/useNotebook";
import { useNotebookNotifications } from "@/hooks/useNotebookNotifications";
import { useCoachWarmUp } from "@/hooks/useCoachWarmUp";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { ThemedText } from "@/components/ThemedText";
import CoachChat from "@/components/coach/CoachChat";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { useAcknowledgeReminders } from "@/hooks/useAcknowledgeReminders";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";
import { logger } from "@/lib/logger";
import type { CoachChatNavigationProp } from "@/types/navigation";
import type { ChatStackParamList } from "@/navigation/ChatStackNavigator";
import {
  getCachedLastBriefSeenDate,
  markBriefSeen,
} from "@/lib/coach-brief-seen";
import {
  briefFormFor,
  localDateString,
  shouldOpenBriefDraft,
} from "@/components/coach/opening-brief-decision";
import type { BriefForm } from "@shared/lib/opening-brief";

export default function CoachProScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  // While typing, the input drops the tab-bar padding — the keyboard covers
  // the tab bar then.
  const keyboardVisible = useKeyboardVisible();
  const isCoachPro = usePremiumFeature("coachPro");
  // CoachChat's own catch (handleSend) shows a visible streamingError on a
  // creation failure — opt out so the global net doesn't double it.
  const { mutateAsync: createConversation } = useCreateConversation({
    silentError: true,
  });
  const [conversationId, setConversationId] = useState<number | null>(null);
  const {
    data: coachConversations = [],
    isError: conversationsError,
    refetch: refetchConversations,
  } = useChatConversations("coach");
  // This screen is the Coach tab's persistent stack root, so the thread bar
  // below never remounts. Its reachable stale trigger: dismissing the Ask
  // Coach overlay (CoachOverlayContent, hosted by the root-stack
  // `fullScreenModal` CoachChat route — this screen is blurred while it is up)
  // mid-answer invalidates the `["/api/chat/conversations"]` prefix with
  // `refetchType: "none"`, which matches this `{ type: "coach" }` key but only
  // refetches on an observer mount. Pick it up on refocus instead; the hook's
  // settle-margin follow-up covers the refocus landing in the same transition
  // as that dismissal, before the server's post-disconnect write.
  const refetchConversationsOnFocus = useCallback(() => {
    void refetchConversations();
  }, [refetchConversations]);
  // settleMs: the refocus usually lands in the same transition as the abort
  // that invalidated this list with `refetchType: "none"` — re-read once the
  // server's post-disconnect write has settled (see the constant's comment).
  useRefreshOnFocus(refetchConversationsOnFocus, {
    settleMs: REFRESH_ON_FOCUS_SETTLE_MS,
  });
  const warmUpHook = useCoachWarmUp(conversationId);
  const navigation = useNavigation<CoachChatNavigationProp>();
  const route = useRoute<RouteProp<ChatStackParamList, "CoachPro">>();
  const { acknowledge } = useAcknowledgeReminders();
  // Reminders clear when the user actually sends a message, not on mere
  // screen focus — fire at most once per mount.
  const hasAcknowledgedRef = useRef(false);
  const handleMessageSent = useCallback(() => {
    if (hasAcknowledgedRef.current) return;
    hasAcknowledgedRef.current = true;
    acknowledge().catch((err) => {
      hasAcknowledgedRef.current = false;
      logger.warn("[CoachProScreen] acknowledge failed", err);
    });
  }, [acknowledge]);

  const pinnedConversations = useMemo(
    () => coachConversations.filter((c) => c.isPinned),
    [coachConversations],
  );
  const unpinnedConversations = useMemo(
    () => coachConversations.filter((c) => !c.isPinned).slice(0, 6),
    [coachConversations],
  );
  const threadBarConversations = useMemo(
    () => [...pinnedConversations, ...unpinnedConversations],
    [pinnedConversations, unpinnedConversations],
  );

  // Set by the New chip: the user asked for an empty draft, so the first-load
  // auto-select below must not put a thread back (it re-runs whenever the id
  // returns to null, and the thread list can also arrive after New is tapped).
  // Cleared when a thread is picked or the draft's first message creates one.
  //
  // The opening brief (spec 2026-11-08): on the first visit of the day, or
  // when a reminder lit the tab dot, the screen opens on a fresh draft with
  // the coach's brief instead of the last thread. Decided ONCE, here, from
  // values already in memory — never switched after a later fetch lands. A
  // conversation named by the route always wins.
  const { hasPending: hasPendingReminder } = usePendingReminders();
  const [isNewDraft, setIsNewDraft] = useState(() =>
    shouldOpenBriefDraft({
      hasPendingReminder,
      lastSeen: getCachedLastBriefSeenDate(),
      today: localDateString(new Date()),
      hasExplicitConversation: route.params?.selectedConversationId != null,
    }),
  );
  // Frozen per draft: marking today seen must not swap the brief on screen.
  const [draftForm, setDraftForm] = useState<BriefForm>(() =>
    briefFormFor(
      getCachedLastBriefSeenDate(),
      localDateString(new Date()),
      hasPendingReminder,
    ),
  );
  const startDraft = useCallback(() => {
    setDraftForm(
      briefFormFor(
        getCachedLastBriefSeenDate(),
        localDateString(new Date()),
        hasPendingReminder,
      ),
    );
    setIsNewDraft(true);
    setConversationId(null);
  }, [hasPendingReminder]);
  const isDraft = conversationId === null;
  const { brief } = useCoachBrief(draftForm, isDraft);
  // The conversation the draft's first send created, and the brief it showed:
  // kept on screen until that conversation's saved copy loads (CoachChat
  // hides it once messages arrive), so the brief never blinks out mid-send.
  const [briefThread, setBriefThread] = useState<{
    id: number;
    brief: NonNullable<typeof brief>;
  } | null>(null);
  const shownBrief = isDraft
    ? brief
    : briefThread?.id === conversationId
      ? briefThread.brief
      : null;
  const onBriefShown = useCallback(() => {
    if (draftForm === "full") markBriefSeen(localDateString(new Date()));
  }, [draftForm]);

  // Adjusted during render (guarded: once an id is set it stops), not in an
  // effect.
  if (!conversationId && !isNewDraft && threadBarConversations.length > 0) {
    setConversationId(threadBarConversations[0].id);
  }

  // Apply a conversation selected from AllConversationsScreen (navigation param pattern
  // replaces the non-serializable onSelect callback that was previously passed as a route param).
  useEffect(() => {
    const selectedId = route.params?.selectedConversationId;
    if (selectedId !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- consumes a one-shot navigation param; the state must land together with the navigation.setParams clear below
      setIsNewDraft(false);
      setConversationId(selectedId);
      navigation.setParams({ selectedConversationId: undefined });
    }
  }, [route.params?.selectedConversationId, navigation]);

  const { cancelStaleReminders } = useNotebookNotifications();
  const { data: notebookEntries = [], isLoading: isEntriesLoading } =
    useNotebookEntries({
      status: "active",
    });

  useEffect(() => {
    if (isEntriesLoading) return;
    const activeIds = notebookEntries
      .filter((e) => e.type === "commitment")
      .map((e) => e.id);
    cancelStaleReminders(activeIds).catch((err) =>
      logger.error("Failed to cancel stale reminders", err),
    );

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active")
        cancelStaleReminders(activeIds).catch((err) =>
          logger.error("Failed to cancel stale reminders", err),
        );
    });
    return () => sub.remove();
  }, [notebookEntries, isEntriesLoading, cancelStaleReminders]);

  const handleCreateConversation = useCallback(async () => {
    const result = await createConversation({ type: "coach" });
    setBriefThread(brief ? { id: result.id, brief } : null);
    setConversationId(result.id);
    setIsNewDraft(false);
    return result.id;
  }, [createConversation, brief]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.threadBar, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={startDraft}
          style={({ pressed }) => [
            styles.newThreadButton,
            {
              borderColor: theme.border,
              backgroundColor: pressed
                ? theme.backgroundSecondary
                : theme.backgroundDefault,
            },
          ]}
          hitSlop={{ top: 4, bottom: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Start a new coach conversation"
        >
          <ThemedText
            type="caption"
            style={[styles.bold, { color: theme.link }]}
          >
            New
          </ThemedText>
        </Pressable>
        {conversationsError && threadBarConversations.length === 0 ? (
          <Pressable
            onPress={() => refetchConversations()}
            style={[styles.threadChip, { borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Couldn't load conversations. Retry."
          >
            <Feather
              name="alert-circle"
              size={12}
              color={theme.textSecondary}
              style={styles.pinIcon}
              accessible={false}
            />
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary }}
              numberOfLines={1}
            >
              Couldn&apos;t load · Retry
            </ThemedText>
          </Pressable>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.threadList}
        >
          {threadBarConversations.map((conversation) => {
            const isSelected = conversation.id === conversationId;
            return (
              <Pressable
                key={conversation.id}
                onPress={() => {
                  setIsNewDraft(false);
                  setConversationId(conversation.id);
                }}
                style={[
                  styles.threadChip,
                  {
                    borderColor: isSelected ? theme.link : theme.border,
                    backgroundColor: isSelected
                      ? theme.backgroundSecondary
                      : theme.backgroundDefault,
                  },
                ]}
                hitSlop={{ top: 4, bottom: 4 }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${conversation.isPinned ? "Pinned. " : ""}Open coach conversation ${conversation.title}`}
              >
                {conversation.isPinned && (
                  <Feather
                    name="bookmark"
                    size={10}
                    color={theme.link}
                    style={styles.pinIcon}
                    accessible={false}
                  />
                )}
                <ThemedText
                  type="caption"
                  numberOfLines={1}
                  style={{
                    color: isSelected ? theme.text : theme.textSecondary,
                  }}
                >
                  {conversation.title || "Coach conversation"}
                </ThemedText>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => navigation.navigate("AllConversations")}
            style={[
              styles.threadChip,
              styles.seeAllChip,
              { borderColor: theme.border },
            ]}
            accessibilityRole="button"
            accessibilityLabel="See all conversations"
          >
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              See all ›
            </ThemedText>
          </Pressable>
        </ScrollView>
        <Pressable
          onPress={() => navigation.navigate("NotebookScreen")}
          style={({ pressed }) => [
            styles.notebookButton,
            pressed && { backgroundColor: theme.backgroundSecondary },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Notebook"
        >
          <Feather name="book-open" size={18} color={theme.link} />
        </Pressable>
      </View>
      <CoachChat
        conversationId={conversationId}
        onCreateConversation={handleCreateConversation}
        isCoachPro={isCoachPro}
        warmUpHook={warmUpHook}
        onMessageSent={handleMessageSent}
        inputBarStyle={{
          paddingBottom: keyboardVisible ? Spacing.sm : tabBarHeight,
        }}
        onReminderHandled={handleMessageSent}
        openingBrief={
          shownBrief
            ? { brief: shownBrief, form: draftForm, onShown: onBriefShown }
            : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  notebookButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.sm,
  },
  threadBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  newThreadButton: {
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bold: { fontFamily: FontFamily.semiBold },
  threadList: {
    gap: Spacing.sm,
    paddingRight: Spacing.md,
  },
  threadChip: {
    flexDirection: "row",
    width: 148,
    minHeight: 36,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pinIcon: { marginRight: 3 },
  seeAllChip: { width: 72 },
});
