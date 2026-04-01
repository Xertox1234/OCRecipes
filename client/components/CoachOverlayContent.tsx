import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AccessibilityInfo,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ChatBubble } from "@/components/ChatBubble";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  useCreateConversation,
  useChatMessages,
  useSendMessage,
} from "@/hooks/useChat";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { CoachQuestion } from "@/context/CoachOverlayContext";

interface CoachOverlayContentProps {
  question: CoachQuestion;
  screenContext: string;
  onDismiss: () => void;
}

export function CoachOverlayContent({
  question,
  screenContext,
  onDismiss,
}: CoachOverlayContentProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const insets = useSafeAreaInsets();

  const [conversationId, setConversationId] = useState<number | null>(null);
  const [inputText, setInputText] = useState("");
  const [createError, setCreateError] = useState(false);
  const didSendInitialRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const titleRef = useRef<View>(null);

  const createConversation = useCreateConversation();
  const { data: messages } = useChatMessages(conversationId);
  const { sendMessage, streamingContent, isStreaming, streamError } =
    useSendMessage(conversationId);

  // Step 1: Create conversation on mount
  useEffect(() => {
    if (didSendInitialRef.current) return;
    didSendInitialRef.current = true;

    createConversation
      .mutateAsync(question.text.slice(0, 50))
      .then((conv) => {
        setConversationId(conv.id);
      })
      .catch(() => {
        setCreateError(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2: Send initial question once conversation is created
  useEffect(() => {
    if (conversationId && !messages?.length) {
      sendMessage(question.question, screenContext);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Build display messages — same pattern as the proven RecipeCoachChatScreen
  const displayMessages = [
    ...(messages ?? []).filter((m) => m.role !== "system"),
    ...(isStreaming && streamingContent
      ? [
          {
            id: -1,
            conversationId: conversationId ?? 0,
            role: "assistant" as const,
            content: streamingContent,
            metadata: null,
            createdAt: new Date().toISOString(),
          },
        ]
      : []),
  ];

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: !reducedMotion });
  }, [streamingContent, messages, reducedMotion]);

  // Accessibility: move focus to title on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (titleRef.current) {
        const handle = findNodeHandle(titleRef.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // Accessibility: announce streaming status
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      AccessibilityInfo.announceForAccessibility("Coach is typing a response");
    }
    if (!isStreaming && prevStreamingRef.current) {
      AccessibilityInfo.announceForAccessibility("Coach response received");
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const handleSend = useCallback(() => {
    if (!inputText.trim() || isStreaming) return;
    sendMessage(inputText.trim());
    setInputText("");
  }, [inputText, isStreaming, sendMessage]);

  const handleRetry = useCallback(() => {
    setCreateError(false);
    didSendInitialRef.current = false;
    createConversation
      .mutateAsync(question.text.slice(0, 50))
      .then((conv) => {
        setConversationId(conv.id);
      })
      .catch(() => setCreateError(true));
  }, [createConversation, question]);

  const canSend =
    inputText.trim().length > 0 && !isStreaming && !!conversationId;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
      accessibilityViewIsModal
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + Spacing.sm,
            borderBottomColor: theme.border,
          },
        ]}
      >
        <Pressable
          onPress={onDismiss}
          style={styles.closeButton}
          accessibilityLabel="Close coach"
          accessibilityRole="button"
          hitSlop={12}
        >
          <Feather name="x" size={24} color={theme.text} />
        </Pressable>
        <View ref={titleRef} accessible accessibilityRole="header">
          <ThemedText type="h4" style={styles.headerTitle}>
            Coach
          </ThemedText>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Messages */}
      {!conversationId && !createError ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.link} />
          <ThemedText
            style={[styles.loadingText, { color: theme.textSecondary }]}
          >
            Starting conversation...
          </ThemedText>
        </View>
      ) : createError ? (
        <View style={styles.loadingContainer}>
          <Feather name="alert-circle" size={32} color={theme.error} />
          <ThemedText
            style={[styles.loadingText, { color: theme.textSecondary }]}
          >
            Could not start conversation
          </ThemedText>
          <Pressable
            onPress={handleRetry}
            style={[styles.retryButton, { borderColor: theme.link }]}
            accessibilityRole="button"
            accessibilityLabel="Retry starting conversation"
          >
            <ThemedText style={{ color: theme.link }}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.messageList}
          contentContainerStyle={[
            styles.messageListContent,
            { paddingBottom: Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {displayMessages.map((msg) => (
            <ChatBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              isStreaming={msg.id === -1}
            />
          ))}
          {streamError && (
            <View
              style={styles.errorBanner}
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
            >
              <Feather
                name="alert-circle"
                size={14}
                color={theme.error}
                importantForAccessibility="no"
              />
              <ThemedText style={[styles.errorText, { color: theme.error }]}>
                Response interrupted. Try sending again.
              </ThemedText>
            </View>
          )}
        </ScrollView>
      )}

      {/* Input Bar */}
      {conversationId && !createError && (
        <View
          style={[
            styles.inputBar,
            {
              borderTopColor: theme.border,
              paddingBottom: insets.bottom + Spacing.sm,
              backgroundColor: theme.backgroundRoot,
            },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: withOpacity(theme.text, 0.06),
                color: theme.text,
              },
            ]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask a follow-up..."
            placeholderTextColor={theme.textSecondary}
            multiline
            maxLength={2000}
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={handleSend}
            accessibilityLabel="Type a follow-up question"
            accessibilityHint="Press return to send"
          />
          <Pressable
            onPress={handleSend}
            style={[
              styles.sendButton,
              {
                backgroundColor: canSend
                  ? theme.link
                  : withOpacity(theme.link, 0.3),
              },
            ]}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
          >
            <Feather name="send" size={16} color={theme.buttonText} />
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
  },
  closeButton: {
    width: 32,
    alignItems: "flex-start",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  errorText: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 15,
    fontFamily: FontFamily.regular,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
});
