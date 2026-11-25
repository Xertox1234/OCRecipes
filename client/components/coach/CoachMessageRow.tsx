import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ChatBubble } from "@/components/ChatBubble";
import BlockRenderer from "@/components/coach/blocks";
import MemoryRefsTag from "@/components/coach/MemoryRefsTag";
import ReportReplyButton from "@/components/coach/ReportReplyButton";
import { RecipeCard as GeneratedRecipeCard } from "@/components/recipe-chat/RecipeCard";
import type { AdjustChoicesStore } from "@/components/recipe-finder/recipe-offer-utils";
import type { MessageView } from "@/components/coach/coach-chat-utils";
import type { ChatMessage, StreamingRecipe } from "@/hooks/useChat";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import type { WriteCardEdits } from "@shared/schemas/coach-write-cards";
import type {
  FinderAction,
  FinderButton,
  FinderItem,
} from "@shared/schemas/recipe-finder";

type BlockRendererProps = React.ComponentProps<typeof BlockRenderer>;

interface CoachMessageRowProps {
  message: ChatMessage;
  view: MessageView;
  /** This message is the one being read aloud right now. */
  isSpeaking: boolean;
  onSpeak: (messageId: number, content: string) => void;
  /** A live reply is streaming below this row. */
  showLiveReply: boolean;
  isActive: boolean;
  usedQuickReplies: ReadonlySet<string>;
  onBlockAction: NonNullable<BlockRendererProps["onAction"]>;
  onQuickReply: NonNullable<BlockRendererProps["onQuickReply"]>;
  lockedFinderButtons: FinderButton[];
  onFinderAction: (action: FinderAction, label: string) => void;
  onLockedFinderButton: (button: FinderButton) => void;
  onOpenFinderItem: (item: FinderItem) => void;
  onMakeFinderItem: (item: FinderItem, flowId: string) => void;
  makingFinderItemId: number | null;
  expiredFinderFlowIds: ReadonlySet<string>;
  adjustChoices: AdjustChoicesStore;
  writeCardEdits: Record<string, WriteCardEdits>;
  onWriteCardEdit: (cardId: string, edits: WriteCardEdits) => void;
  generated:
    | { recipe: StreamingRecipe; allergenWarning: string | null }
    | undefined;
  isSavingRecipe: boolean;
  isRecipeFavourited: boolean;
  onSaveRecipe: (messageId: number) => void;
  onFavouriteRecipe: (messageId: number, savedRecipeId: number | null) => void;
  onRetry: () => void;
}

/** One saved chat message: its bubble, blocks, recipe card and reply actions. */
function CoachMessageRowImpl({
  message: msg,
  view,
  isSpeaking,
  onSpeak,
  showLiveReply,
  isActive,
  usedQuickReplies,
  onBlockAction,
  onQuickReply,
  lockedFinderButtons,
  onFinderAction,
  onLockedFinderButton,
  onOpenFinderItem,
  onMakeFinderItem,
  makingFinderItemId,
  expiredFinderFlowIds,
  adjustChoices,
  writeCardEdits,
  onWriteCardEdit,
  generated,
  isSavingRecipe,
  isRecipeFavourited,
  onSaveRecipe,
  onFavouriteRecipe,
  onRetry,
}: CoachMessageRowProps) {
  const { theme } = useTheme();
  const {
    isAssistant,
    hasFinderBlock,
    isHeld,
    blocksForMsg,
    isRetryTarget,
    memoryRefIds,
    savedRecipeId,
  } = view;
  return (
    <View>
      {!hasFinderBlock && (
        <ChatBubble
          role={msg.role as "user" | "assistant"}
          content={msg.content}
          onSpeak={isAssistant ? () => onSpeak(msg.id, msg.content) : undefined}
          isSpeaking={isSpeaking}
        />
      )}
      {blocksForMsg?.map((block: CoachBlock, i) => {
        const bKey = `${msg.id}-${i}`;
        return (
          <BlockRenderer
            key={`${msg.id}-block-${i}`}
            block={block}
            onAction={onBlockAction}
            onQuickReply={onQuickReply}
            blockKey={bKey}
            isUsed={usedQuickReplies.has(bKey)}
            isActive={isActive}
            lockedFinderButtons={lockedFinderButtons}
            onFinderAction={onFinderAction}
            onLockedFinderButton={onLockedFinderButton}
            onOpenFinderItem={onOpenFinderItem}
            onMakeFinderItem={onMakeFinderItem}
            makingFinderItemId={makingFinderItemId}
            expiredFinderFlowIds={expiredFinderFlowIds}
            messageContent={msg.content}
            adjustChoices={adjustChoices}
            writeCardEdits={
              block.type === "write_card"
                ? writeCardEdits[block.cardId]
                : undefined
            }
            onWriteCardEdit={onWriteCardEdit}
            replyInFlight={showLiveReply}
          />
        );
      })}
      {memoryRefIds ? <MemoryRefsTag ids={memoryRefIds} /> : null}
      {generated ? (
        <GeneratedRecipeCard
          recipe={generated.recipe}
          allergenWarning={generated.allergenWarning}
          isSaved={savedRecipeId !== null}
          isSaving={isSavingRecipe}
          onSave={() => onSaveRecipe(msg.id)}
          isFavourited={isRecipeFavourited}
          onFavourite={() => onFavouriteRecipe(msg.id, savedRecipeId)}
        />
      ) : null}
      {/* Privacy audit G7: every saved AI reply can be reported, cards
          and block-only replies included. Not while the footer still
          shows the rest of this reply. */}
      {isAssistant && !isHeld ? <ReportReplyButton messageId={msg.id} /> : null}
      {isRetryTarget && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Regenerate response"
        >
          <Text style={[styles.retryText, { color: theme.textSecondary }]}>
            ↺ Regenerate
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export const CoachMessageRow = React.memo(CoachMessageRowImpl);

const styles = StyleSheet.create({
  retryButton: {
    alignSelf: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: Spacing.sm,
    marginTop: 2,
    // WCAG 2.5.5 AAA: lift the tap target to ≥44pt. alignSelf: flex-start keeps
    // the width hugging the label; minHeight raises height only.
    minHeight: 44,
    justifyContent: "center",
  },
  retryText: { fontSize: 12 },
});
