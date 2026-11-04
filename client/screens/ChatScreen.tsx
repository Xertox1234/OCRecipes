import React, {
  useCallback,
  useRef,
  useState,
  useMemo,
  useEffect,
} from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  AccessibilityInfo,
  type TextInputInstance,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import {
  FieldCounter,
  CHAT_MESSAGE_MAX_LENGTH,
  counterTone,
} from "@/components/FieldCounter";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import {
  useRoute,
  useNavigation,
  useFocusEffect,
} from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ChatBubble } from "@/components/ChatBubble";
import { ThemedText } from "@/components/ThemedText";
import { EmptyState, OfflineEmptyState } from "@/components/EmptyState";
import { isPausedWithoutData } from "@/components/empty-state-utils";
import { TypingDots } from "@/components/TypingDots";
import { SendButton } from "@/components/SendButton";
import { InlineMicButton } from "@/components/InlineMicButton";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { useSafeTabBarHeight } from "@/hooks/useSafeTabBarHeight";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";
import { getInputBarBottomPadding } from "@/components/bottom-budget-utils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useToast } from "@/context/ToastContext";
import {
  useChatMessages,
  useSendMessage,
  useCreateConversation,
} from "@/hooks/useChat";
import { usePendingAssistantBridge } from "@/hooks/usePendingAssistantBridge";
import { useAcknowledgeReminders } from "@/hooks/useAcknowledgeReminders";
import { viewCoachConversation } from "@/hooks/useCoachUnreadReplies";
import {
  Spacing,
  FontFamily,
  BorderRadius,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type {
  RouteProp,
  CompositeNavigationProp,
} from "@react-navigation/native";
import type { ChatStackParamList } from "@/navigation/ChatStackNavigator";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "@/navigation/MainTabNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  SUGGESTED_PROMPTS,
  type SuggestedPrompt,
} from "@/screens/coach-teaching-prompts";

// Composite so a teaching prompt can open the camera (a root-stack screen).
type ChatScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<ChatStackParamList, "Chat">,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;
type ChatScreenRouteProp = RouteProp<ChatStackParamList, "Chat">;

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

const CoachStreamingFooter = React.memo(function CoachStreamingFooter({
  content,
}: {
  content: string;
}) {
  const { theme } = useTheme();

  if (content) {
    return (
      <ChatBubble role="assistant" content={content} isStreaming animateEntry />
    );
  }

  return (
    <View
      style={styles.typingRow}
      accessible
      accessibilityRole="text"
      accessibilityLabel="NutriCoach is thinking"
    >
      <View
        style={[styles.typingAvatarDot, { backgroundColor: theme.accentSolid }]}
      />
      <View style={styles.typingIndicator}>
        <TypingDots color={theme.textSecondary} />
      </View>
    </View>
  );
});

const SuggestedPrompts = React.memo(function SuggestedPrompts({
  onSelect,
  onOpenCamera,
  onUpgrade,
}: {
  onSelect: (prompt: string) => void;
  onOpenCamera: () => void;
  onUpgrade: () => void;
}) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  // A teaching or Pro prompt is answered here, under the prompts.
  const [answered, setAnswered] = React.useState<Exclude<
    SuggestedPrompt,
    { kind: "ask" }
  > | null>(null);

  const handlePress = (prompt: SuggestedPrompt) => {
    if (prompt.kind === "ask") {
      onSelect(prompt.text);
    } else {
      setAnswered(prompt);
      // No chat message carries this answer, so tell screen readers directly
      // (no live region here, so on both platforms).
      AccessibilityInfo.announceForAccessibility(prompt.answer);
    }
  };

  return (
    <View style={styles.suggestionsContainer}>
      <View style={styles.suggestionsHeader}>
        <View
          style={[
            styles.coachAvatar,
            { backgroundColor: withOpacity(theme.link, 0.12) },
          ]}
        >
          <Feather
            name="heart"
            size={24}
            color={theme.link}
            accessible={false}
          />
        </View>
        <ThemedText type="h4" style={styles.suggestionsTitle}>
          NutriCoach
        </ThemedText>
        <ThemedText
          type="small"
          style={[styles.suggestionsSubtitle, { color: theme.textSecondary }]}
        >
          I can help with nutrition advice, meal planning, and reaching your
          health goals. Try asking:
        </ThemedText>
      </View>
      <View style={styles.promptsGrid}>
        {SUGGESTED_PROMPTS.map((prompt, index) => (
          <Animated.View
            key={prompt.text}
            entering={
              reducedMotion
                ? undefined
                : FadeInUp.delay(index * 80).duration(300)
            }
          >
            <Pressable
              onPress={() => handlePress(prompt)}
              style={({ pressed }) => [
                styles.promptChip,
                {
                  backgroundColor: pressed
                    ? withOpacity(theme.link, 0.15)
                    : withOpacity(theme.link, 0.08),
                  borderColor: withOpacity(theme.link, 0.2),
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Suggested prompt: ${prompt.text}${
                prompt.kind === "pro" ? " (Pro)" : ""
              }`}
            >
              <Feather
                name="message-circle"
                size={14}
                color={theme.link}
                style={styles.promptIcon}
              />
              <ThemedText
                type="small"
                style={[styles.promptText, { color: theme.text }]}
              >
                {prompt.text}
              </ThemedText>
              {prompt.kind === "pro" ? (
                <View
                  style={[
                    styles.proBadge,
                    { backgroundColor: theme.accentSolid },
                  ]}
                  accessible={false}
                >
                  <ThemedText
                    style={[styles.proBadgeText, { color: theme.buttonText }]}
                  >
                    Pro
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
        ))}
      </View>
      {answered ? (
        <View style={styles.teachingAnswer}>
          <ChatBubble role="assistant" content={answered.answer} />
          <Pressable
            onPress={answered.kind === "teach" ? onOpenCamera : onUpgrade}
            accessibilityRole="button"
            accessibilityLabel={answered.actionLabel}
            style={({ pressed }) => [
              styles.teachingAction,
              {
                backgroundColor: theme.accentSolid,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <ThemedText
              style={[styles.teachingActionText, { color: theme.buttonText }]}
            >
              {answered.actionLabel}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

function ChatSkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <SkeletonProvider>
      <View
        accessibilityElementsHidden
        style={{
          flex: 1,
          justifyContent: "flex-end",
          padding: Spacing.lg,
          gap: Spacing.lg,
        }}
      >
        {/* Left-aligned bubble (assistant) */}
        <View style={{ alignSelf: "flex-start", gap: Spacing.xs }}>
          <SkeletonBox
            width={200}
            height={16}
            borderRadius={BorderRadius["2xl"]}
          />
          <SkeletonBox
            width={140}
            height={16}
            borderRadius={BorderRadius["2xl"]}
          />
        </View>
        {/* Right-aligned bubble (user) */}
        <View style={{ alignSelf: "flex-end" }}>
          <SkeletonBox
            width={180}
            height={16}
            borderRadius={BorderRadius["2xl"]}
          />
        </View>
        {/* Left-aligned bubble (assistant, longer) */}
        <View style={{ alignSelf: "flex-start", gap: Spacing.xs }}>
          <SkeletonBox
            width={240}
            height={16}
            borderRadius={BorderRadius["2xl"]}
          />
          <SkeletonBox
            width={200}
            height={16}
            borderRadius={BorderRadius["2xl"]}
          />
          <SkeletonBox
            width={160}
            height={16}
            borderRadius={BorderRadius["2xl"]}
          />
        </View>
        {/* Right-aligned bubble (user, short) */}
        <View style={{ alignSelf: "flex-end" }}>
          <SkeletonBox
            width={120}
            height={16}
            borderRadius={BorderRadius["2xl"]}
          />
        </View>
      </View>
    </SkeletonProvider>
  );
}

export default function ChatScreen() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation = useNavigation<ChatScreenNavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();
  const headerInset = useHeaderContentInset(Spacing.md);
  const tabBarHeight = useSafeTabBarHeight();
  const keyboardVisible = useKeyboardVisible();
  const insets = useSafeAreaInsets();

  const conversationId =
    route.params && "conversationId" in route.params
      ? route.params.conversationId
      : null;
  // Only a string is ever auto-sent: linking.ts strips this param from links,
  // but a repeated query key would arrive as an array.
  const routeInitialMessage: unknown =
    route.params && "initialMessage" in route.params
      ? route.params.initialMessage
      : undefined;
  const initialMessage =
    typeof routeInitialMessage === "string" ? routeInitialMessage : undefined;

  // `conversationId` is omitted (null) for the in-app "start a new chat"
  // flow; a deep link always provides a value, and a malformed one coerces to
  // 0 (or a negative number — linking's parseIntOrZero does not clamp
  // negatives). Malformed is specifically "present but not a positive
  // integer" — NOT any falsy id — otherwise a bad link silently starts a new
  // chat with it. Precedent: NotebookEntryScreen.tsx (docs/rules/react-native.md).
  const isMalformedId = conversationId !== null && !(conversationId > 0);
  const validConversationId = isMalformedId ? null : conversationId;

  const queryClient = useQueryClient();
  const {
    data: messages,
    isLoading,
    isError: messagesError,
    fetchStatus: messagesFetchStatus,
    refetch: refetchMessages,
  } = useChatMessages(validConversationId);
  const {
    sendMessage,
    getStreamSnapshot,
    streamingContent,
    isStreaming,
    streamError,
    requestError,
  } = useSendMessage(validConversationId, { notifyWhenAway: true });
  // A reply delivered only in onload never renders in the streaming state;
  // the bridge reads the hook's own record when the stream stops instead.
  const readFinalStreamContent = useCallback(
    () => getStreamSnapshot().content,
    [getStreamSnapshot],
  );
  // Report which conversation is on screen so a reply that finishes while the
  // user is elsewhere can be flagged unread (Coach tab dot + toast). FOCUS is
  // the signal, not unmount: a bottom-tab screen stays MOUNTED when its tab
  // loses focus, so an unmount-only signal would miss a tab switch — while
  // after a pop-back the reply keeps running (#1183) and finishes unseen too.
  // The callback re-runs when `validConversationId` changes (the new-chat flow
  // gets its id from setParams after the first send creates the conversation)
  // and its cleanup runs on blur and on unmount. Opening the conversation also
  // clears its unread mark.
  useFocusEffect(
    useCallback(
      () => viewCoachConversation(queryClient, validConversationId),
      [queryClient, validConversationId],
    ),
  );
  // handleSend's own catch below already toasts on a creation failure —
  // opt out so the global net doesn't double it.
  const createConversation = useCreateConversation({ silentError: true });
  const { acknowledge } = useAcknowledgeReminders();
  // Reminders clear when the user actually sends a message, not on mere
  // screen focus — fire at most once per mount.
  const hasAcknowledgedRef = useRef(false);

  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const composerFocus = useFieldFocus();

  // Voice input APPENDS to whatever was typed before the mic was tapped and
  // never sends — the user reviews the dictation and taps Send themselves.
  // null = no dictation in progress (a late final result must not refill).
  const voiceBaseRef = useRef<string | null>(null);
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();
  useEffect(() => {
    const base = voiceBaseRef.current;
    if (base !== null && transcript && (isListening || isFinal)) {
      setInputText(
        (base ? `${base} ${transcript}` : transcript).slice(
          0,
          CHAT_MESSAGE_MAX_LENGTH,
        ),
      );
    }
  }, [isListening, isFinal, transcript]);
  useEffect(() => {
    if (speechError) toast.error(speechError);
  }, [speechError, toast]);
  // A reply that starts streaming locks the composer; end any capture too.
  useEffect(() => {
    if (isStreaming && isListening && voiceBaseRef.current !== null) {
      stopListening();
    }
  }, [isStreaming, isListening, stopListening]);
  const handleVoicePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      voiceBaseRef.current = inputText.trim();
      void startListening();
    }
  }, [haptics, isListening, inputText, startListening, stopListening]);
  const shownStreamErrorRef = useRef(false);
  const shownRequestErrorRef = useRef(false);

  const pendingAssistantContent = usePendingAssistantBridge<string>({
    isStreaming,
    streamingValue: streamingContent,
    hasStreamingValue: !!streamingContent,
    readFinalValue: readFinalStreamContent,
    hasError: !!streamError || !!requestError,
    assistantMessageCount: (messages || []).filter(
      (m) => m.role === "assistant",
    ).length,
    announce: { message: "Coach response received", always: true },
  });

  useEffect(() => {
    if (streamError && !shownStreamErrorRef.current) {
      shownStreamErrorRef.current = true;
      toast.error("Response interrupted. Try sending again.");
    }
    if (!streamError) {
      shownStreamErrorRef.current = false;
    }
  }, [streamError, toast]);

  useEffect(() => {
    if (requestError && !shownRequestErrorRef.current) {
      shownRequestErrorRef.current = true;
      // Daily-limit errors include an upgrade prompt; others show the server message directly
      if (requestError.toLowerCase().includes("limit")) {
        toast.error(`${requestError} Upgrade to Premium for more messages.`);
      } else {
        toast.error(requestError);
      }
    }
    if (!requestError) {
      shownRequestErrorRef.current = false;
    }
  }, [requestError, toast]);

  useEffect(() => {
    if (!isStreaming) return;
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
  }, [isStreaming]);

  // Auto-send initial message from cross-tab navigation (e.g. Ask Coach)
  const didSendInitialRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !didSendInitialRef.current) {
      didSendInitialRef.current = true;
      void handleSend(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  // The messages query isn't refetched until the reply finishes, so the
  // text just sent is held locally until the saved copy lands. Keyed on the
  // saved user-message count at send time, not on matching text, so
  // repeating an earlier message still shows straight away.
  const savedUserCount = (messages ?? []).filter(
    (m) => m.role === "user",
  ).length;
  // Tied to its conversation: the screen stays mounted when the Coach tab
  // re-points it at another one.
  const [pendingUser, setPendingUser] = useState<{
    content: string;
    savedUserCount: number;
    conversationId: number | null;
    /** requestError already showing at send time. useSendMessage only
     *  clears it once the request starts, and a first message awaits the
     *  conversation create before that, so it must clear before an error
     *  can count as this send's. */
    staleError: string | null;
  } | null>(null);
  const showPendingUser =
    pendingUser !== null &&
    pendingUser.conversationId === conversationId &&
    savedUserCount <= pendingUser.savedUserCount;

  // Once its own conversation holds the saved copy, the pending copy is
  // done with. A different conversation only hides it: during a first send
  // the new id reaches the pending copy a render before the route.
  const pendingUserSaved =
    pendingUser !== null &&
    pendingUser.conversationId === conversationId &&
    savedUserCount > pendingUser.savedUserCount;
  useEffect(() => {
    if (pendingUserSaved) setPendingUser(null);
  }, [pendingUserSaved]);

  // A request that failed before any reply (requestError) never triggers the
  // refetch that would replace the local copy, so drop it here and give the
  // draft back for a resend.
  useEffect(() => {
    if (!pendingUser) return;
    if (pendingUser.staleError !== null) {
      if (requestError === null) {
        setPendingUser({ ...pendingUser, staleError: null });
      }
      return;
    }
    if (requestError) {
      setPendingUser(null);
      setInputText((current) => current || pendingUser.content);
    }
  }, [requestError, pendingUser]);

  // Build display messages from fetched messages only; streaming renders in
  // ListFooterComponent so token updates do not invalidate visible rows.
  const displayMessages = useMemo(() => {
    const mappedMessages = (messages || []).map((m) => ({
      id: m.id.toString(),
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      createdAt: m.createdAt,
    }));
    if (showPendingUser) {
      mappedMessages.push({
        id: "pending-user",
        role: "user",
        content: pendingUser.content,
        createdAt: new Date().toISOString(),
      });
    }
    if (pendingAssistantContent) {
      mappedMessages.push({
        id: "pending-assistant",
        role: "assistant",
        content: pendingAssistantContent,
        createdAt: new Date().toISOString(),
      });
    }
    return mappedMessages;
  }, [messages, pendingAssistantContent, showPendingUser, pendingUser]);

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text || inputText).trim();
      // A malformed id (see isMalformedId above) must never create or send —
      // this guard also covers the cross-tab initialMessage auto-send effect
      // below, which fires independently of what the not-found render shows.
      if (!content || isStreaming || isMalformedId) return;

      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      voiceBaseRef.current = null;
      if (isListening) stopListening();
      setInputText("");
      setPendingUser({
        content,
        savedUserCount,
        conversationId,
        staleError: requestError,
      });

      try {
        if (conversationId === null) {
          // Auto-create a conversation if none exists
          const conversation = await createConversation.mutateAsync(undefined);
          // The pending copy follows the new conversation's id.
          setPendingUser((p) =>
            p ? { ...p, conversationId: conversation.id } : p,
          );
          navigation.setParams({ conversationId: conversation.id });
          // navigation.setParams doesn't apply until the next render, so
          // sendMessage (closed over the pre-update conversationId) would
          // silently drop this message — pass the fresh id explicitly via the
          // override param instead of relying on the closure.
          await sendMessage(content, undefined, conversation.id);
        } else {
          await sendMessage(content);
        }
        if (!hasAcknowledgedRef.current) {
          hasAcknowledgedRef.current = true;
          acknowledge().catch(() => {
            hasAcknowledgedRef.current = false;
          });
        }
      } catch (e) {
        // sendMessage reports its own failures through requestError (see the
        // effect below); this catch is the conversation-create failure, so
        // nothing was sent. Drop the local copy and give the draft back,
        // unless the user has already started typing something new.
        setPendingUser(null);
        setInputText((current) => current || content);
        const message =
          e instanceof Error ? e.message : "Failed to send message";
        if (
          message.includes("429") ||
          message.includes("DAILY_LIMIT_REACHED")
        ) {
          toast.error(
            "Daily limit reached. Upgrade to Premium for unlimited messages.",
          );
        } else {
          toast.error("Could not send message. Please try again.");
        }
      }
    },
    [
      inputText,
      isListening,
      stopListening,
      isStreaming,
      isMalformedId,
      haptics,
      savedUserCount,
      requestError,
      conversationId,
      createConversation,
      navigation,
      sendMessage,
      acknowledge,
      toast,
    ],
  );

  const [showUpgrade, setShowUpgrade] = useState(false);
  const handleOpenCamera = useCallback(() => {
    navigation.navigate("Scan");
  }, [navigation]);
  const handleShowUpgrade = useCallback(() => setShowUpgrade(true), []);

  const handlePromptSelect = useCallback(
    // handleSend buzzes; a second impact here would double it.
    (prompt: string) => {
      void handleSend(prompt);
    },
    [handleSend],
  );

  const renderItem = useCallback(({ item }: { item: DisplayMessage }) => {
    return (
      <ChatBubble
        role={item.role}
        content={item.content}
        isStreaming={false}
        animateEntry={item.id === "pending-user"}
      />
    );
  }, []);

  if (isMalformedId) {
    return (
      <View
        style={[
          styles.notFound,
          { backgroundColor: theme.backgroundRoot, paddingTop: headerInset },
        ]}
      >
        <ThemedText
          style={[styles.notFoundText, { color: theme.textSecondary }]}
        >
          {"This chat couldn't be found."}
        </ThemedText>
        {/* A chat/:id deep link builds a Coach stack holding only Chat, so the
            header has no back button. Don't branch on canGoBack(): it bubbles
            to the tab navigator (backBehavior "firstRoute") and goBack() would
            land on Home. popTo pops back to an existing ChatList, or REPLACES
            this screen with one (v7 navigate() would push, leaving the dead end
            behind the list). */}
        <Pressable
          onPress={() => navigation.popTo("ChatList")}
          hitSlop={12}
          style={styles.notFoundBackButton}
          accessibilityRole="button"
          accessibilityLabel="Back to chats"
        >
          <ThemedText style={[styles.notFoundBack, { color: theme.link }]}>
            Back to chats
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  const streamingFooter = isStreaming ? (
    <CoachStreamingFooter content={streamingContent} />
  ) : null;

  // An existing conversation whose messages failed to load must not render
  // as a blank new chat — a send would land in it with its history unseen.
  const loadFailed =
    messagesError &&
    validConversationId !== null &&
    (!messages || messages.length === 0) &&
    !isStreaming &&
    !showPendingUser;

  // Offline cold start: the messages query is paused (not loading, no error).
  const loadPaused =
    validConversationId !== null &&
    isPausedWithoutData(messagesFetchStatus, !!messages?.length) &&
    !isStreaming &&
    !showPendingUser;

  const isEmpty =
    !isLoading &&
    (!messages || messages.length === 0) &&
    !isStreaming &&
    !showPendingUser;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {isLoading ? (
        <ChatSkeleton />
      ) : loadFailed ? (
        <View style={[styles.emptyContent, { paddingTop: headerInset }]}>
          <EmptyState
            variant="temporary"
            icon="alert-circle"
            title="Couldn't load this conversation"
            description="Something went wrong. Tap below to try again."
            actionLabel="Try Again"
            onAction={() => {
              void refetchMessages();
            }}
          />
        </View>
      ) : loadPaused ? (
        <View style={[styles.emptyContent, { paddingTop: headerInset }]}>
          <OfflineEmptyState what="conversation" />
        </View>
      ) : isEmpty ? (
        <FlatList
          ref={flatListRef}
          data={[]}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.messagesContent,
            styles.emptyContent,
            { paddingTop: headerInset },
          ]}
          ListEmptyComponent={
            <SuggestedPrompts
              onSelect={handlePromptSelect}
              onOpenCamera={handleOpenCamera}
              onUpgrade={handleShowUpgrade}
            />
          }
        />
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListFooterComponent={streamingFooter ?? undefined}
          contentContainerStyle={[
            styles.messagesContent,
            { paddingTop: headerInset },
          ]}
          keyboardDismissMode="interactive"
          {...FLATLIST_DEFAULTS}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }}
          onLayout={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
        />
      )}

      {/* Input bar */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: theme.backgroundRoot,
            borderTopColor: theme.border,
            paddingBottom: getInputBarBottomPadding({
              keyboardVisible,
              tabBarHeight,
              insetBottom: insets.bottom,
              restingGap: Spacing.sm,
            }),
          },
        ]}
      >
        <FocusField
          focus={composerFocus}
          style={[
            styles.inputBar,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <FocusTextInput
            ref={inputRef}
            focusRing={false}
            onFocus={composerFocus.onFocus}
            onBlur={composerFocus.onBlur}
            style={[styles.textInput, { color: theme.text }]}
            placeholder="Ask NutriCoach..."
            placeholderTextColor={theme.textSecondary}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={() => handleSend()}
            multiline
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            // Return sends, as in the coach composer (CoachChatBase with
            // submitOnReturn) — never a line break.
            returnKeyType="send"
            submitBehavior="blurAndSubmit"
            editable={!isStreaming}
            accessibilityLabel="Message input"
            accessibilityHint="Type your question for NutriCoach"
          />
          <InlineMicButton
            isListening={isListening}
            volume={volume}
            onPress={handleVoicePress}
            disabled={isStreaming}
          />
          <SendButton
            onPress={() => handleSend()}
            canSend={inputText.trim().length > 0}
            busy={isStreaming}
            style={styles.sendButton}
          />
        </FocusField>
        <FieldCounter
          overlay
          length={inputText.length}
          max={CHAT_MESSAGE_MAX_LENGTH}
          visible={
            composerFocus.focused &&
            counterTone(inputText.length, CHAT_MESSAGE_MAX_LENGTH) !== "normal"
          }
        />
      </View>
      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  proBadge: {
    marginLeft: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  proBadgeText: {
    fontSize: 11,
    fontFamily: FontFamily.semiBold,
  },
  teachingAnswer: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  teachingAction: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    minHeight: 44,
    justifyContent: "center",
  },
  teachingActionText: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  container: {
    flex: 1,
  },
  messagesContent: {
    paddingBottom: Spacing.md,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  notFoundText: {
    fontSize: 15,
    textAlign: "center",
  },
  notFoundBackButton: {
    minHeight: 44,
    justifyContent: "center",
    marginTop: Spacing.md,
  },
  notFoundBack: {
    fontSize: 15,
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  typingAvatarDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  typingIndicator: {
    minHeight: 25,
    justifyContent: "center",
  },
  suggestionsContainer: {
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
  },
  suggestionsHeader: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  coachAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  suggestionsTitle: {
    fontFamily: FontFamily.bold,
    marginBottom: Spacing.xs,
  },
  suggestionsSubtitle: {
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: Spacing.lg,
  },
  promptsGrid: {
    width: "100%",
    gap: Spacing.sm,
  },
  promptChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  promptIcon: {
    marginRight: Spacing.sm,
  },
  promptText: {
    fontFamily: FontFamily.medium,
    flex: 1,
  },
  inputContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: BorderRadius.card,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.xs,
    gap: Spacing.sm,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FontFamily.regular,
    maxHeight: 100,
    paddingVertical: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  sendButton: {
    marginBottom: 2,
  },
});
