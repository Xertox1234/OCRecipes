import React, { memo } from "react";
import { View } from "react-native";
import { LayoutAnimationConfig } from "react-native-reanimated";
import { ChatBubble } from "@/components/ChatBubble";
import BlockRenderer from "@/components/coach/blocks";
import { CoachStatusRow } from "@/components/coach/CoachStatusRow";
import { blockEntranceDelays } from "@/components/coach/blocks/block-entrance";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import type { WriteCardEdits } from "@shared/schemas/coach-write-cards";

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
  /** Coach write cards: edits per card, and the setter (owned by the chat). */
  writeCardEdits?: Record<string, WriteCardEdits>;
  onWriteCardEdit?: (cardId: string, edits: WriteCardEdits) => void;
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
  writeCardEdits,
  onWriteCardEdit,
}: StreamingBubbleProps) {
  const entryDelays = blockEntranceDelays(streamBlocks);
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
            writeCardEdits={
              block.type === "write_card"
                ? writeCardEdits?.[block.cardId]
                : undefined
            }
            onWriteCardEdit={onWriteCardEdit}
            animateEntry
            entryDelayMs={entryDelays[i]}
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
