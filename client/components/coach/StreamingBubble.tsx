import React, { memo } from "react";
import { View } from "react-native";
import { LayoutAnimationConfig } from "react-native-reanimated";
import { ChatBubble } from "@/components/ChatBubble";
import BlockRenderer from "@/components/coach/blocks";
import { CoachStatusRow } from "@/components/coach/CoachStatusRow";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

interface StreamingBubbleProps {
  streamingContent: string;
  statusText: string;
  isStreaming: boolean;
  streamBlocks: CoachBlock[];
  onBlockAction: (action: Record<string, unknown>) => void;
  onQuickReply: (message: string) => void;
  onCommitmentAccept: (
    notebookEntryId: number | undefined,
    title: string,
    followUpDate: string,
  ) => void;
  ttsSpeak: (messageId: number, text: string) => void;
  isSpeaking: boolean;
  speakingMessageId: number | null;
}

const StreamingBubble = memo(function StreamingBubble({
  streamingContent,
  statusText,
  isStreaming,
  streamBlocks,
  onBlockAction,
  onQuickReply,
  onCommitmentAccept,
  ttsSpeak,
  isSpeaking,
  speakingMessageId,
}: StreamingBubbleProps) {
  return (
    <View>
      {isStreaming && streamingContent ? (
        <ChatBubble
          role="assistant"
          content={streamingContent}
          onSpeak={() => ttsSpeak(-1, streamingContent)}
          isSpeaking={speakingMessageId === -1 && isSpeaking}
          animateEntry
        />
      ) : null}
      {/* The saved reply takes over from these in place, so their exit
          animations (the quick replies' fade) would leave a fading second
          row. skipExiting skips them only when this wrapper itself goes. */}
      <LayoutAnimationConfig skipExiting>
        {streamBlocks.map((block, i) => (
          <BlockRenderer
            key={`stream-block-${i}`}
            block={block}
            onAction={onBlockAction}
            onQuickReply={onQuickReply}
            onCommitmentAccept={onCommitmentAccept}
            animateEntry
          />
        ))}
      </LayoutAnimationConfig>
      {isStreaming && !streamingContent && statusText ? (
        <CoachStatusRow statusText={statusText} />
      ) : null}
    </View>
  );
});

export default StreamingBubble;
