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
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useToast } from "@/context/ToastContext";
import {
  useChatMessages,
  useSendMessage,
  useCreateConversation,
} from "@/hooks/useChat";
import {
  Spacing,
  FontFamily,
  BorderRadius,
  withOpacity,
} from "@/constants/theme";
import { pressSpringConfig } from "@/constants/animations";
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

function SuggestedPrompts({
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
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<ChatScreenNavigationProp>();
  const route = useRoute<ChatScreenRouteProp>();

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

  const { data: messages, isLoading } = useChatMessages(conversationId);
  const { sendMessage, streamingContent, isStreaming, streamError } =
    useSendMessage(conversationId);
  const createConversation = useCreateConversation();

  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const prevStreamingRef = useRef(false);
  const shownStreamErrorRef = useRef(false);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      AccessibilityInfo.announceForAccessibility("Coach response received");
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (streamError && !shownStreamErrorRef.current) {
      shownStreamErrorRef.current = true;
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error("Response was interrupted. Partial response may be visible.");
    }
    if (!streamError) {
      shownStreamErrorRef.current = false;
    }
  }, [streamError, toast, haptics]);

  // Auto-send initial message from cross-tab navigation (e.g. Ask Coach)
  const didSendInitialRef = useRef(false);
  useEffect(() => {
    if (initialMessage && !didSendInitialRef.current) {
      didSendInitialRef.current = true;
      handleSend(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  // Build display messages: fetched messages + optimistic user message + streaming assistant
  const displayMessages = useMemo(() => {
    const result: DisplayMessage[] = (messages || []).map((m) => ({
      id: m.id.toString(),
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      createdAt: m.createdAt,
    }));

    if (isStreaming && streamingContent) {
      result.push({
        id: "streaming",
        role: "assistant",
        content: streamingContent,
        createdAt: new Date().toISOString(),
      });
    } else if (isStreaming && !streamingContent) {
      // Typing indicator
      result.push({
        id: "typing",
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      });
    }

    return result;
  }, [messages, isStreaming, streamingContent]);

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text || inputText).trim();
      if (!content || isStreaming) return;

      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setInputText("");

      try {
        if (!conversationId) {
          // Auto-create a conversation if none exists
          const conversation = await createConversation.mutateAsync(undefined);
          navigation.setParams({ conversationId: conversation.id });
          // Need to wait and send after navigation updates
          // For now, just send immediately after creating
          await sendMessage(content);
        } else {
          await sendMessage(content);
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
      haptics,
      conversationId,
      createConversation,
      navigation,
      sendMessage,
      toast,
    ],
  );

  const handlePromptSelect = useCallback(
    (prompt: string) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      handleSend(prompt);
    },
    [haptics, handleSend],
  );

  const renderItem = useCallback(({ item }: { item: DisplayMessage }) => {
    return (
      <ChatBubble
        role={item.role}
        content={item.content}
        isStreaming={item.id === "typing" || item.id === "streaming"}
      />
    );
  }, []);

  const isEmpty =
    !isLoading && (!messages || messages.length === 0) && !isStreaming;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={theme.link} size="large" />
        </View>
      ) : isEmpty ? (
        <FlatList
          ref={flatListRef}
          data={[]}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.messagesContent, styles.emptyContent]}
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
          contentContainerStyle={styles.messagesContent}
          keyboardDismissMode="interactive"
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
            paddingBottom: Math.max(insets.bottom, Spacing.sm),
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
                    ? theme.link
                    : withOpacity(theme.link, 0.3),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !inputText.trim() || isStreaming }}
          >
            {isStreaming ? (
              <ActivityIndicator color={theme.buttonText} size="small" />
            ) : (
              <Feather name="send" size={18} color={theme.buttonText} />
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  messagesContent: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  emptyContent: {
    flexGrow: 1,
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
