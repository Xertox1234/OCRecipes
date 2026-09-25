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
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AccessibilityInfo,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

import { ChatBubble } from "@/components/ChatBubble";
import { ThemedText } from "@/components/ThemedText";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { useToast } from "@/context/ToastContext";
import {
  useChatMessages,
  useSendMessage,
  useCreateConversation,
} from "@/hooks/useChat";
import { usePendingAssistantBridge } from "@/hooks/usePendingAssistantBridge";
import { useAcknowledgeReminders } from "@/hooks/useAcknowledgeReminders";
import {
  Spacing,
  FontFamily,
  BorderRadius,
  withOpacity,
  TAB_BAR_HEIGHT,
} from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { ChatStackParamList } from "@/navigation/ChatStackNavigator";

type ChatScreenNavigationProp = NativeStackNavigationProp<
  ChatStackParamList,
  "Chat"
>;
type ChatScreenRouteProp = RouteProp<ChatStackParamList, "Chat">;

interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

const SUGGESTED_PROMPTS = [
  "What should I eat today?",
  "How can I hit my protein goal?",
  "Analyze my eating patterns",
  "Suggest a healthy snack",
];

const CoachStreamingFooter = React.memo(function CoachStreamingFooter({
  content,
}: {
  content: string;
}) {
  const { theme } = useTheme();

  if (content) {
    return <ChatBubble role="assistant" content={content} isStreaming />;
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
        <ActivityIndicator size="small" color={theme.textSecondary} />
      </View>
    </View>
  );
});

const SuggestedPrompts = React.memo(function SuggestedPrompts({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();

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
            key={prompt}
            entering={
              reducedMotion
                ? undefined
                : FadeInUp.delay(index * 80).duration(300)
            }
          >
            <Pressable
              onPress={() => onSelect(prompt)}
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
              accessibilityLabel={`Suggested prompt: ${prompt}`}
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
                {prompt}
              </ThemedText>
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </View>
  );
});

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<ChatScreenNavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();
  const headerInset = useHeaderContentInset(Spacing.md);

  const sendButtonScale = useSharedValue(1);
  const sendButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendButtonScale.value }],
  }));

  const conversationId =
    route.params && "conversationId" in route.params
      ? route.params.conversationId
      : null;
  const initialMessage =
    route.params && "initialMessage" in route.params
      ? route.params.initialMessage
      : undefined;

  // `conversationId` is omitted (null) for the in-app "start a new chat"
  // flow; a deep link always provides a value, and a malformed one coerces to
  // 0 (or a negative number — linking's parseIntOrZero does not clamp
  // negatives). Malformed is specifically "present but not a positive
  // integer" — NOT any falsy id — otherwise a bad link silently starts a new
  // chat with it. Precedent: NotebookEntryScreen.tsx (docs/rules/react-native.md).
  const isMalformedId = conversationId !== null && !(conversationId > 0);
  const validConversationId = isMalformedId ? null : conversationId;

  const { data: messages, isLoading } = useChatMessages(validConversationId);
  const {
    sendMessage,
    streamingContent,
    isStreaming,
    streamError,
    requestError,
  } = useSendMessage(validConversationId);
  const createConversation = useCreateConversation();
  const { acknowledge } = useAcknowledgeReminders();
  // Reminders clear when the user actually sends a message, not on mere
  // screen focus — fire at most once per mount.
  const hasAcknowledgedRef = useRef(false);

  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const shownStreamErrorRef = useRef(false);
  const shownRequestErrorRef = useRef(false);

  const pendingAssistantContent = usePendingAssistantBridge<string>({
    isStreaming,
    streamingValue: streamingContent,
    hasStreamingValue: !!streamingContent,
    hasError: !!streamError || !!requestError,
    assistantMessageCount: (messages || []).filter(
      (m) => m.role === "assistant",
    ).length,
    announce: { message: "Coach response received", always: true },
  });

  useEffect(() => {
    if (streamError && !shownStreamErrorRef.current) {
      shownStreamErrorRef.current = true;
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error("Response interrupted. Try sending again.");
    }
    if (!streamError) {
      shownStreamErrorRef.current = false;
    }
  }, [streamError, toast, haptics]);

  useEffect(() => {
    if (requestError && !shownRequestErrorRef.current) {
      shownRequestErrorRef.current = true;
      haptics.notification(Haptics.NotificationFeedbackType.Error);
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
  }, [requestError, toast, haptics]);

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

  // Build display messages from fetched messages only; streaming renders in
  // ListFooterComponent so token updates do not invalidate visible rows.
  const displayMessages = useMemo(() => {
    const mappedMessages = (messages || []).map((m) => ({
      id: m.id.toString(),
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      createdAt: m.createdAt,
    }));
    if (pendingAssistantContent) {
      mappedMessages.push({
        id: "pending-assistant",
        role: "assistant",
        content: pendingAssistantContent,
        createdAt: new Date().toISOString(),
      });
    }
    return mappedMessages;
  }, [messages, pendingAssistantContent]);

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text || inputText).trim();
      // A malformed id (see isMalformedId above) must never create or send —
      // this guard also covers the cross-tab initialMessage auto-send effect
      // below, which fires independently of what the not-found render shows.
      if (!content || isStreaming || isMalformedId) return;

      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setInputText("");

      try {
        if (conversationId === null) {
          // Auto-create a conversation if none exists
          const conversation = await createConversation.mutateAsync(undefined);
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
        haptics.notification(Haptics.NotificationFeedbackType.Error);
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
      isStreaming,
      isMalformedId,
      haptics,
      conversationId,
      createConversation,
      navigation,
      sendMessage,
      acknowledge,
      toast,
    ],
  );

  const handlePromptSelect = useCallback(
    (prompt: string) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      void handleSend(prompt);
    },
    [haptics, handleSend],
  );

  const renderItem = useCallback(({ item }: { item: DisplayMessage }) => {
    return (
      <ChatBubble role={item.role} content={item.content} isStreaming={false} />
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

  const isEmpty =
    !isLoading && (!messages || messages.length === 0) && !isStreaming;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {isLoading ? (
        <ChatSkeleton />
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
            <SuggestedPrompts onSelect={handlePromptSelect} />
          }
        />
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListFooterComponent={streamingFooter}
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
            paddingBottom: TAB_BAR_HEIGHT,
          },
        ]}
      >
        <View
          style={[
            styles.inputBar,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <TextInput
            ref={inputRef}
            style={[styles.textInput, { color: theme.text }]}
            placeholder="Ask NutriCoach..."
            placeholderTextColor={theme.textSecondary}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={() => handleSend()}
            multiline
            maxLength={2000}
            returnKeyType="default"
            editable={!isStreaming}
            accessibilityLabel="Message input"
            accessibilityHint="Type your question for NutriCoach"
          />
          <AnimatedPressable
            onPress={() => handleSend()}
            onPressIn={() => {
              if (!reducedMotion) {
                sendButtonScale.value = withSpring(0.85, pressSpringConfig);
              }
            }}
            onPressOut={() => {
              if (!reducedMotion) {
                sendButtonScale.value = withSpring(1, pressSpringConfig);
              }
            }}
            disabled={!inputText.trim() || isStreaming}
            style={[
              styles.sendButton,
              sendButtonStyle,
              {
                backgroundColor:
                  inputText.trim() && !isStreaming
                    ? theme.accentSolid
                    : withOpacity(theme.text, 0.12),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !inputText.trim() || isStreaming }}
          >
            {isStreaming ? (
              <ActivityIndicator color={theme.textSecondary} size="small" />
            ) : (
              <Feather
                name="send"
                size={18}
                color={
                  inputText.trim() ? theme.buttonText : theme.textSecondary
                }
              />
            )}
          </AnimatedPressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 2,
  },
});
