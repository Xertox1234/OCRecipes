import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { ThemedText } from "@/components/ThemedText";
import { ChatBubble } from "@/components/ChatBubble";
import { useTheme } from "@/hooks/useTheme";
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

type Props = NativeStackScreenProps<RootStackParamList, "RecipeCoachChat">;

export default function RecipeCoachChatScreen({ navigation, route }: Props) {
  const { recipeId, recipeType, initialQuestion } = route.params;
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [inputText, setInputText] = useState("");
  const [createError, setCreateError] = useState(false);
  const didSendInitialRef = useRef(false);
  const flatListRef = useRef<FlatList>(null);

  const createConversation = useCreateConversation();
  const { data: messages } = useChatMessages(conversationId);
  const { sendMessage, streamingContent, isStreaming } =
    useSendMessage(conversationId);

  // Create conversation and send initial question on mount
  useEffect(() => {
    if (didSendInitialRef.current) return;
    didSendInitialRef.current = true;

    createConversation
      .mutateAsync(`Recipe: ${route.params.initialQuestion.slice(0, 50)}`)
      .then((conv) => {
        setConversationId(conv.id);
      })
      .catch(() => {
        setCreateError(true);
      });
  }, []);

  // Send initial message once conversation is created
  useEffect(() => {
    if (conversationId && !messages?.length) {
      sendMessage(initialQuestion);
    }
  }, [conversationId]);

  const handleSend = useCallback(() => {
    if (!inputText.trim() || isStreaming) return;
    sendMessage(inputText.trim());
    setInputText("");
  }, [inputText, isStreaming, sendMessage]);

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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
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
          onPress={() => navigation.goBack()}
          style={styles.closeButton}
          accessibilityLabel="Dismiss coach chat"
          accessibilityRole="button"
          hitSlop={12}
        >
          <Feather name="x" size={24} color={theme.text} />
        </Pressable>
        <ThemedText type="h4" style={styles.headerTitle}>
          Recipe Coach
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {/* Messages */}
      {!conversationId ? (
        <View style={styles.loadingContainer}>
          {createError ? (
            <>
              <Feather name="alert-circle" size={32} color={theme.error} />
              <ThemedText
                style={[styles.loadingText, { color: theme.textSecondary }]}
              >
                Could not start conversation
              </ThemedText>
              <Pressable
                onPress={() => {
                  setCreateError(false);
                  didSendInitialRef.current = false;
                  createConversation
                    .mutateAsync(
                      `Recipe: ${route.params.initialQuestion.slice(0, 50)}`,
                    )
                    .then((conv) => setConversationId(conv.id))
                    .catch(() => setCreateError(true));
                }}
                style={[styles.retryButton, { borderColor: theme.link }]}
                accessibilityRole="button"
                accessibilityLabel="Retry starting conversation"
              >
                <ThemedText style={{ color: theme.link }}>Retry</ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={theme.link} />
              <ThemedText
                style={[styles.loadingText, { color: theme.textSecondary }]}
              >
                Starting conversation...
              </ThemedText>
            </>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ChatBubble role={item.role} content={item.content} />
          )}
          contentContainerStyle={[
            styles.messageList,
            { paddingBottom: Spacing.md },
          ]}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />
      )}

      {/* Input */}
      <View
        style={[
          styles.inputBar,
          {
            paddingBottom: insets.bottom + Spacing.sm,
            borderTopColor: theme.border,
            backgroundColor: theme.backgroundDefault,
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: withOpacity(theme.text, 0.06),
              color: theme.text,
              fontFamily: FontFamily.regular,
            },
          ]}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask about this recipe..."
          placeholderTextColor={theme.textSecondary}
          multiline
          maxLength={2000}
          editable={!!conversationId && !isStreaming}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <Pressable
          onPress={handleSend}
          disabled={!inputText.trim() || isStreaming}
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: theme.link },
            pressed && { opacity: 0.85 },
            (!inputText.trim() || isStreaming) && { opacity: 0.4 },
          ]}
          accessibilityLabel="Send message"
          accessibilityRole="button"
        >
          <Feather
            name="send"
            size={18}
            color="#FFFFFF" // hardcoded
          />
        </Pressable>
      </View>
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
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: 14,
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  messageList: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
