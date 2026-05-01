import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  AccessibilityInfo,
  findNodeHandle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import { ThemedText } from "@/components/ThemedText";
import { ChatBubble } from "@/components/ChatBubble";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useCreateConversation, useChatMessages } from "@/hooks/useChat";
import { useCoachStream } from "@/hooks/useCoachStream";
import { CoachChatBase } from "@/components/coach/CoachChatBase";
import { CoachStatusRow } from "@/components/coach/CoachStatusRow";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";

export interface CoachQuestion {
  readonly text: string;
  readonly question: string;
}

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
  const queryClient = useQueryClient();

  const [conversationId, setConversationId] = useState<number | null>(null);
  const [inputText, setInputText] = useState("");
  const [createError, setCreateError] = useState(false);
  const [streamError, setStreamError] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const titleRef = useRef<View>(null);

  const createConversation = useCreateConversation();
  const { data: messages } = useChatMessages(conversationId);

  const {
    startStream,
    abortStream,
    streamingContent,
    statusText,
    isStreaming,
  } = useCoachStream({
    onDone: (_fullText, _blocks) => {
      if (conversationId !== null) {
        queryClient.invalidateQueries({
          queryKey: [`/api/chat/conversations/${conversationId}/messages`],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/chat/conversations"],
        });
      }
    },
    onError: () => {
      setStreamError(true);
      // accessibilityLiveRegion is Android-only — announce for iOS VoiceOver
      AccessibilityInfo.announceForAccessibility(
        "Response interrupted. Try sending again.",
      );
    },
  });

  // Create conversation on mount
  const didCreateRef = useRef(false);
  useEffect(() => {
    if (didCreateRef.current) return;
    didCreateRef.current = true;

    createConversation
      .mutateAsync({ title: question.text.slice(0, 50) })
      .then((conv) => {
        setConversationId(conv.id);
      })
      .catch(() => {
        setCreateError(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Send initial question once conversation is created
  const didSendRef = useRef(false);
  useEffect(() => {
    if (!conversationId || didSendRef.current) return;
    didSendRef.current = true;

    startStream(conversationId, question.question, { screenContext });

    return () => {
      abortStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Build display messages — show optimistic user bubble before server messages load
  const serverMessages = (messages ?? []).filter((m) => m.role !== "system");
  const showOptimisticUser = serverMessages.length === 0 && didSendRef.current;

  const displayMessages = [
    ...(showOptimisticUser
      ? [
          {
            id: -2,
            conversationId: conversationId ?? 0,
            role: "user" as const,
            content: question.question,
            metadata: null,
            createdAt: new Date().toISOString(),
          },
        ]
      : []),
    ...serverMessages,
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
    if (!inputText.trim() || isStreaming || !conversationId) return;
    const text = inputText.trim();
    setInputText("");
    setStreamError(false);
    startStream(conversationId, text);
  }, [inputText, isStreaming, conversationId, startStream]);

  const handleRetry = useCallback(() => {
    setCreateError(false);
    didSendRef.current = false;
    createConversation
      .mutateAsync({ title: question.text.slice(0, 50) })
      .then((conv) => {
        setConversationId(conv.id);
      })
      .catch(() => setCreateError(true));
  }, [createConversation, question]);

  const canSend =
    inputText.trim().length > 0 && !isStreaming && !!conversationId;

  const header = (
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
  );

  return (
    <CoachChatBase
      containerStyle={{ backgroundColor: theme.backgroundRoot }}
      header={header}
      inputText={inputText}
      onChangeText={setInputText}
      onSend={handleSend}
      isStreaming={isStreaming}
      canSend={canSend}
      placeholder="Ask a follow-up..."
      inputAccessibilityLabel="Type a follow-up question"
      multilineInput
      inputBarAlign="flex-end"
      showInputBar={!!conversationId && !createError}
      inputBarStyle={{
        padding: 0,
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: insets.bottom + Spacing.sm,
        backgroundColor: theme.backgroundRoot,
      }}
      keyboardVerticalOffset={0}
      accessibilityViewIsModal
    >
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
          {isStreaming && !streamingContent && statusText ? (
            <CoachStatusRow statusText={statusText} />
          ) : null}
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
    </CoachChatBase>
  );
}

const styles = StyleSheet.create({
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
});
