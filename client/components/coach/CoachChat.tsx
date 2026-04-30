import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { ChatBubble } from "@/components/ChatBubble";
import { useTTS } from "@/hooks/useTTS";
import { InlineError } from "@/components/InlineError";
import BlockRenderer from "@/components/coach/blocks";
import CoachMicButton from "@/components/coach/CoachMicButton";
import { useTheme } from "@/hooks/useTheme";
import {
  useChatMessages,
  useDeleteChatMessageForRetry,
  type ChatMessage,
} from "@/hooks/useChat";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import {
  coachBlockSchema,
  type CoachBlock,
} from "@shared/schemas/coach-blocks";
import { parsePlanDays } from "@/components/coach/coach-chat-utils";
import type { useCoachWarmUp } from "@/hooks/useCoachWarmUp";
import type {
  CoachChatNavigationProp,
  RootStackParamList,
} from "@/types/navigation";

interface CoachChatProps {
  conversationId: number | null;
  onCreateConversation: () => Promise<number>;
  isCoachPro: boolean;
  warmUpHook: ReturnType<typeof useCoachWarmUp>;
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
}

type ChatListItem =
  | { type: "message"; id: string; message: ChatMessage }
  | { type: "optimistic"; id: string; content: string }
  | { type: "stream"; id: string };

function filterValidBlocks(raw: unknown[]): CoachBlock[] {
  const valid: CoachBlock[] = [];
  for (const b of raw) {
    const result = coachBlockSchema.safeParse(b);
    if (result.success) valid.push(result.data);
  }
  return valid;
}

async function sendMessageStreaming(
  conversationId: number,
  content: string,
  onChunk: (accumulated: string) => void,
  onBlocks: (blocks: CoachBlock[]) => void,
  onDone: () => void,
  signal: AbortSignal,
  warmUpId?: string | null,
): Promise<void> {
  const token = await tokenStorage.get();
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${getApiUrl()}/api/chat/conversations/${conversationId}/messages`;
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    let accumulated = "";
    let lastProcessedIndex = 0;
    let settled = false;

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 3 && xhr.responseText) {
        const newText = xhr.responseText.slice(lastProcessedIndex);
        lastProcessedIndex = xhr.responseText.length;

        for (const line of newText.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) {
                rejectOnce(new Error(String(data.error)));
                return;
              }
              if (data.content) {
                accumulated += data.content;
                onChunk(accumulated);
              }
              if (data.blocks && Array.isArray(data.blocks)) {
                onBlocks(filterValidBlocks(data.blocks));
              }
              if (data.done) {
                onDone();
                resolveOnce();
              }
            } catch {
              // Ignore incomplete JSON chunks
            }
          }
        }
      }
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) resolveOnce();
        else rejectOnce(new Error(`${xhr.status}: ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => rejectOnce(new Error("Network error"));
    signal.addEventListener("abort", () => {
      xhr.abort();
      resolveOnce();
    });
    xhr.send(JSON.stringify(warmUpId ? { content, warmUpId } : { content }));
  });
}

export default function CoachChat({
  conversationId,
  onCreateConversation,
  isCoachPro,
  warmUpHook,
  initialMessage,
  onInitialMessageSent,
}: CoachChatProps) {
  const { theme } = useTheme();
  const navigation = useNavigation<CoachChatNavigationProp>();
  const hasVoice = usePremiumFeature("coachPro");
  const deleteChatMessage = useDeleteChatMessageForRetry();
  const queryClient = useQueryClient();

  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamBlocks, setStreamBlocks] = useState<CoachBlock[]>([]);
  const [streamingError, setStreamingError] = useState<string | null>(null);
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(
    null,
  );

  const listRef = useRef<FlatList<ChatListItem>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);
  const prevStreamingRef = useRef(false);
  const pendingStreamingDisplayRef = useRef("");
  const streamingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accessibility announcements for streaming state
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (isStreaming && !wasStreaming) {
      // Streaming just started
      AccessibilityInfo.announceForAccessibility("Coach is thinking...");
    } else if (!isStreaming && wasStreaming) {
      // Streaming just finished
      AccessibilityInfo.announceForAccessibility("Coach responded");
    }
  }, [isStreaming]);

  const { data: messages } = useChatMessages(conversationId);

  const chatItems = useMemo<ChatListItem[]>(() => {
    const items: ChatListItem[] = (messages ?? []).map((message) => ({
      type: "message",
      id: `message-${message.id}`,
      message,
    }));
    if (optimisticMessage) {
      items.push({
        type: "optimistic",
        id: "optimistic",
        content: optimisticMessage,
      });
    }
    if (isStreaming || streamBlocks.length > 0) {
      items.push({ type: "stream", id: "stream" });
    }
    return items;
  }, [messages, optimisticMessage, isStreaming, streamBlocks.length]);

  // Validate blocks once per messages change, not on every render tick
  const messageBlocks = useMemo(() => {
    if (!messages) return new Map<number, CoachBlock[]>();
    const map = new Map<number, CoachBlock[]>();
    for (const msg of messages) {
      const meta = msg.metadata as Record<string, unknown> | null | undefined;
      const rawBlocks = meta?.blocks;
      if (Array.isArray(rawBlocks)) {
        const valid = filterValidBlocks(rawBlocks);
        if (valid.length > 0) map.set(msg.id, valid);
      }
    }
    return map;
  }, [messages]);

  const lastAssistantMessageId = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    const last = messages[messages.length - 1];
    return last.role === "assistant" ? last.id : null;
  }, [messages]);

  const {
    isListening,
    transcript,
    isFinal,
    volume,
    startListening,
    stopListening,
  } = useSpeechToText();

  const {
    isSpeaking,
    speakingMessageId,
    speak: ttsSpeak,
    stop: ttsStop,
  } = useTTS();

  // Show interim transcript in input field while listening
  useEffect(() => {
    if (isListening && transcript) {
      setInputText(transcript);
      // Send warm-up for interim transcript
      if (isCoachPro) {
        warmUpHook.sendWarmUp(transcript);
      }
    }
  }, [isListening, transcript, isCoachPro, warmUpHook]);

  // Auto-send when speech finalizes
  useEffect(() => {
    if (isFinal && transcript) {
      handleSend(transcript);
    }
  }, [isFinal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text || inputText).trim();
      if (!content || isStreaming) return;

      setInputText("");
      setOptimisticMessage(content);
      setIsStreaming(true);
      setStreamingContent("");
      // Stop any active TTS before sending a new message
      ttsStop();
      setStreamBlocks([]);
      setStreamingError(null);

      let convId = conversationId;
      if (!convId) {
        try {
          convId = await onCreateConversation();
        } catch {
          setIsStreaming(false);
          setOptimisticMessage(null);
          return;
        }
      }

      const abort = new AbortController();
      abortRef.current = abort;
      const currentWarmUpId = isCoachPro ? warmUpHook.getWarmUpId() : null;

      try {
        await sendMessageStreaming(
          convId,
          content,
          (accumulated) => {
            // Strip coach_blocks fence from displayed content during streaming
            // Uses indexOf instead of backtracking regex for O(n) performance
            const openIdx = accumulated.indexOf("```coach_blocks\n");
            let display: string;
            if (openIdx === -1) {
              display = accumulated.trim();
            } else {
              const closeIdx = accumulated.indexOf("```", openIdx + 16);
              if (closeIdx === -1) {
                // Fence not yet closed — strip from open to end
                display = accumulated.slice(0, openIdx).trim();
              } else {
                display = (
                  accumulated.slice(0, openIdx) +
                  accumulated.slice(closeIdx + 3)
                ).trim();
              }
            }
            pendingStreamingDisplayRef.current = display;
            if (!streamingFlushRef.current) {
              streamingFlushRef.current = setTimeout(() => {
                setStreamingContent(pendingStreamingDisplayRef.current);
                listRef.current?.scrollToEnd({ animated: false });
                streamingFlushRef.current = null;
              }, 16);
            }
          },
          (blocks) => setStreamBlocks(blocks),
          () => {
            setIsStreaming(false);
            setOptimisticMessage(null);
          },
          abort.signal,
          currentWarmUpId,
        );
      } catch {
        setIsStreaming(false);
        setOptimisticMessage(null);
        setInputText(content);
        setStreamingError(
          "Message failed. Check your connection and try again.",
        );
      }

      warmUpHook.reset();
    },
    [
      inputText,
      isStreaming,
      conversationId,
      onCreateConversation,
      warmUpHook,
      isCoachPro,
      ttsStop,
    ],
  );

  const handleRetry = useCallback(async () => {
    if (!messages || messages.length < 2 || isStreaming) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const msgQueryKey = [`/api/chat/conversations/${conversationId}/messages`];
    const snapshot = queryClient.getQueryData<ChatMessage[]>(msgQueryKey);
    queryClient.setQueryData<ChatMessage[]>(
      msgQueryKey,
      (old) => old?.filter((m) => m.id !== lastMsg.id) ?? [],
    );

    try {
      // Delete assistant then user message (in order — each was "most recent" at time of delete)
      await deleteChatMessage.mutateAsync(lastMsg.id);
      await deleteChatMessage.mutateAsync(lastUserMsg.id);
    } catch {
      queryClient.setQueryData(msgQueryKey, snapshot);
      setStreamingError("Retry failed. Check your connection and try again.");
      return;
    }
    handleSend(lastUserMsg.content);
  }, [
    messages,
    isStreaming,
    conversationId,
    deleteChatMessage,
    queryClient,
    handleSend,
  ]);

  // Auto-send suggestion chip messages
  useEffect(() => {
    if (initialMessage) {
      handleSend(initialMessage);
      onInitialMessageSent?.();
    }
  }, [initialMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBlockAction = useCallback(
    (action: Record<string, unknown>) => {
      if (action.type === "log_food") {
        handleSend(`Please log: ${action.description as string}`);
      } else if (action.type === "navigate") {
        const screen = action.screen as string;
        const params = action.params as Record<string, unknown> | undefined;
        // Typed screen-specific branches — each call uses a literal screen name
        // so TypeScript verifies params against RootStackParamList per screen.
        // Params are Zod-validated upstream via NAVIGABLE_SCREENS enum.
        switch (screen) {
          case "NutritionDetail":
            navigation.navigate(
              "NutritionDetail",
              params as RootStackParamList["NutritionDetail"],
            );
            break;
          case "FeaturedRecipeDetail":
            navigation.navigate(
              "FeaturedRecipeDetail",
              params as RootStackParamList["FeaturedRecipeDetail"],
            );
            break;
          case "RecipeChat":
            navigation.navigate(
              "RecipeChat",
              params as RootStackParamList["RecipeChat"],
            );
            break;
          case "Scan":
            navigation.navigate("Scan", params as RootStackParamList["Scan"]);
            break;
          case "RecipeBrowserModal":
            navigation.navigate(
              "RecipeBrowserModal",
              params as RootStackParamList["RecipeBrowserModal"],
            );
            break;
          case "QuickLog":
            navigation.navigate("QuickLog");
            break;
          case "DailyNutritionDetail":
            navigation.navigate("DailyNutritionDetail");
            break;
          case "WeightTracking":
            navigation.navigate("WeightTracking");
            break;
          case "GoalSetup":
            navigation.navigate("GoalSetup");
            break;
          case "GroceryListsModal":
            navigation.navigate("GroceryListsModal");
            break;
          case "PantryModal":
            navigation.navigate("PantryModal");
            break;
          case "CookbookListModal":
            navigation.navigate("CookbookListModal");
            break;
        }
      } else if (action.type === "add_meal_plan") {
        // Pass the AI-generated meal plan data through to the recipe browser
        const planDays = parsePlanDays(action.plan);
        navigation.navigate("RecipeBrowserModal", { planDays });
      } else if (action.type === "add_grocery_list") {
        navigation.navigate("GroceryListsModal");
      } else if (action.type === "set_goal") {
        navigation.navigate("GoalSetup");
      }
    },
    [handleSend, navigation],
  );

  const handleCommitmentAccept = useCallback(
    (_title: string, _followUpDate: string) => {
      // Commitment is tracked via notebook extraction from the conversation
      // The accept UI state is already managed by CommitmentCard component
    },
    [],
  );

  const handleQuickReply = useCallback(
    (message: string) => {
      handleSend(message);
    },
    [handleSend],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.type === "message") {
        const msg = item.message;
        const isRetryTarget =
          !isStreaming &&
          msg.role === "assistant" &&
          msg.id === lastAssistantMessageId;
        const isAssistant = msg.role === "assistant";
        return (
          <View>
            <ChatBubble
              role={msg.role as "user" | "assistant"}
              content={msg.content}
              onSpeak={
                isAssistant ? () => ttsSpeak(msg.id, msg.content) : undefined
              }
              isSpeaking={
                isAssistant && speakingMessageId === msg.id && isSpeaking
              }
            />
            {messageBlocks.get(msg.id)?.map((block, i) => (
              <BlockRenderer
                key={`${msg.id}-block-${i}`}
                block={block}
                onAction={handleBlockAction}
                onQuickReply={handleQuickReply}
                onCommitmentAccept={handleCommitmentAccept}
              />
            ))}
            {isRetryTarget && (
              <Pressable
                onPress={handleRetry}
                style={styles.retryButton}
                accessibilityRole="button"
                accessibilityLabel="Regenerate response"
              >
                <Text
                  style={[styles.retryText, { color: theme.textSecondary }]}
                >
                  ↺ Regenerate
                </Text>
              </Pressable>
            )}
          </View>
        );
      }

      if (item.type === "optimistic") {
        return <ChatBubble role="user" content={item.content} />;
      }

      return (
        <View>
          {isStreaming && streamingContent && (
            <ChatBubble
              role="assistant"
              content={streamingContent}
              onSpeak={() => ttsSpeak(-1, streamingContent)}
              isSpeaking={speakingMessageId === -1 && isSpeaking}
            />
          )}
          {streamBlocks.map((block, i) => (
            <BlockRenderer
              key={`stream-block-${i}`}
              block={block}
              onAction={handleBlockAction}
              onQuickReply={handleQuickReply}
              onCommitmentAccept={handleCommitmentAccept}
            />
          ))}
          {isStreaming && !streamingContent && (
            <View style={styles.typing}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
            </View>
          )}
        </View>
      );
    },
    [
      handleBlockAction,
      handleCommitmentAccept,
      handleQuickReply,
      handleRetry,
      isStreaming,
      isSpeaking,
      speakingMessageId,
      ttsSpeak,
      lastAssistantMessageId,
      messageBlocks,
      streamBlocks,
      streamingContent,
      theme.textSecondary,
    ],
  );

  useEffect(() => {
    return () => {
      if (streamingFlushRef.current) {
        clearTimeout(streamingFlushRef.current);
        streamingFlushRef.current = null;
      }
    };
  }, []);

  const handleMicPress = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Auto-scroll when new messages arrive (streaming scroll handled in onChunk callback)
  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: false });
  }, [messages]);

  const showSendButton = inputText.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={chatItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() =>
          listRef.current?.scrollToEnd({ animated: false })
        }
      />

      {/* Input bar */}
      <View
        style={[
          styles.inputBar,
          {
            backgroundColor: theme.backgroundSecondary,
            borderTopColor: theme.border,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            { backgroundColor: theme.backgroundDefault, color: theme.text },
          ]}
          placeholder="Ask your coach..."
          placeholderTextColor={theme.textSecondary}
          value={inputText}
          onChangeText={(text) => {
            setInputText(text);
            if (isCoachPro) warmUpHook.sendTextWarmUp(text);
          }}
          onSubmitEditing={() => handleSend()}
          returnKeyType="send"
          multiline={false}
          editable={!isStreaming}
          accessibilityLabel="Message your nutrition coach"
        />
        {showSendButton ? (
          <Pressable
            style={[styles.sendBtn, { backgroundColor: theme.link }]}
            onPress={() => handleSend()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Ionicons name="send" size={16} color={theme.buttonText} />
          </Pressable>
        ) : hasVoice ? (
          <CoachMicButton
            isListening={isListening}
            volume={volume}
            onPress={handleMicPress}
          />
        ) : null}
      </View>
      <InlineError message={streamingError} style={styles.inlineError} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messageList: { flex: 1 },
  messageContent: { padding: Spacing.md, paddingBottom: Spacing.lg },
  typing: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    gap: Spacing.sm,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineError: {
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: Spacing.sm,
    marginTop: 2,
  },
  retryText: { fontSize: 12 },
});
