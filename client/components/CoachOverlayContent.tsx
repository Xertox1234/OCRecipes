import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  AccessibilityInfo,
  Platform,
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
import { useAcknowledgeReminders } from "@/hooks/useAcknowledgeReminders";
import { CoachChatBase } from "@/components/coach/CoachChatBase";
import { CoachStatusRow } from "@/components/coach/CoachStatusRow";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import { logger } from "@/lib/logger";
import {
  isCoachDisclaimerDismissed,
  setCoachDisclaimerDismissed,
} from "@/lib/coach-disclaimer-storage";

const COACH_DISCLAIMER_TEXT =
  "OCRecipes provides general nutrition information, not medical advice. Always consult a qualified healthcare professional before making changes to your diet or medication.";

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
  // `null` while loading from AsyncStorage to avoid a flicker of the banner
  // before the persisted dismissal has been read.
  const [disclaimerVisible, setDisclaimerVisible] = useState<boolean | null>(
    null,
  );

  const scrollRef = useRef<ScrollView>(null);
  const titleRef = useRef<View>(null);

  // Load disclaimer dismissal state from AsyncStorage on mount.
  // `isCoachDisclaimerDismissed()` already swallows read failures and returns
  // `false` (show disclaimer) on error, but we add an explicit `.catch()`
  // here as defense-in-depth so a thrown promise can never leave
  // `disclaimerVisible` stuck at `null` and silently hide the medical notice.
  useEffect(() => {
    let cancelled = false;
    isCoachDisclaimerDismissed()
      .then((dismissed) => {
        if (cancelled) return;
        setDisclaimerVisible(!dismissed);
      })
      .catch(() => {
        if (cancelled) return;
        // Safe default — show the medical disclaimer on any unexpected error.
        setDisclaimerVisible(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Announce disclaimer to screen readers on iOS when it first becomes visible
  // (Android picks it up via accessibilityLiveRegion on the banner).
  const didAnnounceDisclaimerRef = useRef(false);
  useEffect(() => {
    if (
      disclaimerVisible === true &&
      !didAnnounceDisclaimerRef.current &&
      Platform.OS === "ios"
    ) {
      didAnnounceDisclaimerRef.current = true;
      AccessibilityInfo.announceForAccessibility(COACH_DISCLAIMER_TEXT);
    }
  }, [disclaimerVisible]);

  const handleDismissDisclaimer = useCallback(() => {
    setDisclaimerVisible(false);
    // Fire-and-forget — UI state already reflects dismissal.
    void setCoachDisclaimerDismissed();
  }, []);

  const createConversation = useCreateConversation();
  const { data: messages } = useChatMessages(conversationId);
  const { acknowledge } = useAcknowledgeReminders();
  // Reminders clear when the user actually sends a follow-up, not on the
  // auto-sent initial question — fire at most once per mount.
  const hasAcknowledgedRef = useRef(false);

  const {
    startStream,
    abortStream,
    streamingContent,
    statusText,
    isStreaming,
  } = useCoachStream({
    onDone: (_fullText, _blocks) => {
      if (conversationId !== null) {
        void queryClient.invalidateQueries({
          queryKey: [`/api/chat/conversations/${conversationId}/messages`],
        });
        void queryClient.invalidateQueries({
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
    if (!hasAcknowledgedRef.current) {
      hasAcknowledgedRef.current = true;
      acknowledge().catch((err) => {
        hasAcknowledgedRef.current = false;
        logger.warn("[CoachOverlayContent] acknowledge failed", err);
      });
    }
  }, [inputText, isStreaming, conversationId, startStream, acknowledge]);

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
          {disclaimerVisible === true && (
            // The wrapper is intentionally NOT `accessible` — collapsing
            // children into a single node would hide the dismiss button from
            // VoiceOver/TalkBack. The disclaimer text and dismiss button are
            // independent accessibility nodes; the text node carries the
            // live-region announcement and full label.
            <View
              style={[
                styles.disclaimerBanner,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
              accessibilityLiveRegion="polite"
            >
              <Feather
                name="info"
                size={14}
                color={theme.textSecondary}
                importantForAccessibility="no"
              />
              <ThemedText
                type="small"
                accessibilityRole="text"
                style={[styles.disclaimerText, { color: theme.textSecondary }]}
              >
                {COACH_DISCLAIMER_TEXT}
              </ThemedText>
              <Pressable
                onPress={handleDismissDisclaimer}
                accessibilityLabel="Dismiss disclaimer"
                accessibilityRole="button"
                hitSlop={12}
                style={styles.disclaimerDismiss}
              >
                <Feather
                  name="x"
                  size={16}
                  color={theme.textSecondary}
                  importantForAccessibility="no"
                />
              </Pressable>
            </View>
          )}
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
          {/* Error banner is intentionally placed inside the scroll area (adjacent
              to the failed message) rather than using CoachChatBase's streamingError
              prop, which anchors InlineError below the input bar. */}
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
  disclaimerBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
  disclaimerText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    lineHeight: 18,
  },
  disclaimerDismiss: {
    marginTop: -2,
  },
});
