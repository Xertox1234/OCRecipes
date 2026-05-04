import React, { memo } from "react";
import { View } from "react-native";
import { ChatBubble } from "@/components/ChatBubble";
import BlockRenderer from "@/components/coach/blocks";
import { CoachStatusRow } from "@/components/coach/CoachStatusRow";
import { useTTS } from "@/hooks/useTTS";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

interface StreamingBubbleProps {
  streamingContent: string;
  statusText: string;
  isStreaming: boolean;
  streamBlocks: CoachBlock[];
  onBlockAction: (action: Record<string, unknown>) => void;
  onQuickReply: (message: string) => void;
  onCommitmentAccept: (title: string, followUpDate: string) => void;
}

const StreamingBubble = memo(function StreamingBubble({
  streamingContent,
  statusText,
  isStreaming,
  streamBlocks,
  onBlockAction,
  onQuickReply,
  onCommitmentAccept,
}: StreamingBubbleProps) {
  const { speak: ttsSpeak, speakingMessageId, isSpeaking } = useTTS();

  return (
    <View>
      {isStreaming && streamingContent ? (
        <ChatBubble
          role="assistant"
          content={streamingContent}
          onSpeak={() => ttsSpeak(-1, streamingContent)}
          isSpeaking={speakingMessageId === -1 && isSpeaking}
        />
      ) : null}
      {streamBlocks.map((block, i) => (
        <BlockRenderer
          key={`stream-block-${i}`}
          block={block}
          onAction={onBlockAction}
          onQuickReply={onQuickReply}
          onCommitmentAccept={onCommitmentAccept}
        />
      ))}
      {isStreaming && !streamingContent && statusText ? (
        <CoachStatusRow statusText={statusText} />
      ) : null}
    </View>
  );
});

export default StreamingBubble;
