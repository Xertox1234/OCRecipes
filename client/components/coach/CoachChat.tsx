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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ChatBubble } from "@/components/ChatBubble";
import BlockRenderer from "@/components/coach/blocks";
import CoachMicButton from "@/components/coach/CoachMicButton";
import { useTheme } from "@/hooks/useTheme";
import { useChatMessages } from "@/hooks/useChat";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { Spacing, BorderRadius } from "@/constants/theme";
import {
  coachBlockSchema,
  type CoachBlock,
} from "@shared/schemas/coach-blocks";
import type { useCoachWarmUp } from "@/hooks/useCoachWarmUp";

interface CoachChatProps {
  conversationId: number | null;
  onCreateConversation: () => Promise<number>;
  isCoachPro: boolean;
  warmUpHook: ReturnType<typeof useCoachWarmUp>;
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
}

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

    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 3 && xhr.responseText) {
        const newText = xhr.responseText.slice(lastProcessedIndex);
        lastProcessedIndex = xhr.responseText.length;

        for (const line of newText.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                accumulated += data.content;
                onChunk(accumulated);
              }
              if (data.blocks && Array.isArray(data.blocks)) {
                onBlocks(filterValidBlocks(data.blocks));
              }
              if (data.done) {
                onDone();
              }
            } catch {
              // Ignore incomplete JSON chunks
            }
          }
        }
      }
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`${xhr.status}: ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error"));
    signal.addEventListener("abort", () => {
      xhr.abort();
      resolve();
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
  const hasVoice = usePremiumFeature("coachPro");

  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamBlocks, setStreamBlocks] = useState<CoachBlock[]>([]);
  const [optimisticMessage, setOptimisticMessage] = useState<string | null>(
    null,
  );

  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);

  const { data: messages } = useChatMessages(conversationId);
  const {
    isListening,
    transcript,
    isFinal,
    volume,
    startListening,
    stopListening,
  } = useSpeechToText();

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
      setStreamBlocks([]);

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
            const display = accumulated
              .replace(/```coach_blocks\n[\s\S]*?(?:```|$)/, "")
              .trim();
            setStreamingContent(display);
            scrollRef.current?.scrollToEnd({ animated: false });
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
      }

      warmUpHook.reset();
    },
    [inputText, isStreaming, conversationId, onCreateConversation, warmUpHook],
  );

  // Auto-send suggestion chip messages
  useEffect(() => {
    if (initialMessage) {
      handleSend(initialMessage);
      onInitialMessageSent?.();
    }
  }, [initialMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBlockAction = useCallback(
    (action: Record<string, unknown>) => {
      // Action handling — navigation requires parent screen integration
      if (action.type === "log_food") {
        handleSend(`Please log: ${action.description as string}`);
      }
    },
    [handleSend],
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

  const handleMicPress = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Auto-scroll on new content
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [messages, streamingContent]);

  const showSendButton = inputText.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
      >
        {/* Existing messages */}
        {messages?.map((msg) => (
          <View key={msg.id}>
            <ChatBubble
              role={msg.role as "user" | "assistant"}
              content={msg.content}
            />
            {/* Render blocks from message metadata */}
            {(() => {
              const meta = msg.metadata as
                | Record<string, unknown>
                | null
                | undefined;
              const rawBlocks = meta?.blocks;
              const blocks = Array.isArray(rawBlocks)
                ? filterValidBlocks(rawBlocks)
                : undefined;
              return blocks?.map((block, i) => (
                <BlockRenderer
                  key={`${msg.id}-block-${i}`}
                  block={block}
                  onAction={handleBlockAction}
                  onQuickReply={handleQuickReply}
                  onCommitmentAccept={handleCommitmentAccept}
                />
              ));
            })()}
          </View>
        ))}

        {/* Optimistic user message */}
        {optimisticMessage && (
          <ChatBubble role="user" content={optimisticMessage} />
        )}

        {/* Streaming assistant response */}
        {isStreaming && streamingContent && (
          <ChatBubble role="assistant" content={streamingContent} />
        )}

        {/* Streaming blocks */}
        {streamBlocks.map((block, i) => (
          <BlockRenderer
            key={`stream-block-${i}`}
            block={block}
            onAction={handleBlockAction}
            onQuickReply={handleQuickReply}
            onCommitmentAccept={handleCommitmentAccept}
          />
        ))}

        {/* Typing indicator */}
        {isStreaming && !streamingContent && (
          <View style={styles.typing}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
          </View>
        )}
      </ScrollView>

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
          onChangeText={setInputText}
          onSubmitEditing={() => handleSend()}
          returnKeyType="send"
          multiline={false}
          editable={!isStreaming}
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
