import React from "react";
import Animated from "react-native-reanimated";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import ActionCard from "./ActionCard";
import SuggestionList from "./SuggestionList";
import InlineChart from "./InlineChart";
import CommitmentCard from "./CommitmentCard";
import QuickReplies from "./QuickReplies";
import RecipeCard from "./RecipeCard";
import MealPlanCard from "./MealPlanCard";
import CheckedTrail from "./CheckedTrail";
import WriteCard from "./write-cards/WriteCard";
import type { WriteCardEdits } from "@shared/schemas/coach-write-cards";
import { RecipeFinderMessage } from "@/components/recipe-finder/RecipeFinderMessage";
import type { AdjustChoicesStore } from "@/components/recipe-finder/recipe-offer-utils";
import { useAccessibility } from "@/hooks/useAccessibility";
import { chatBlockRiseEntrance } from "@/constants/animations";
import type {
  FinderAction,
  FinderButton,
  FinderItem,
} from "@shared/schemas/recipe-finder";

interface BlockRendererProps {
  block: CoachBlock;
  onAction?: (action: Record<string, unknown>) => void;
  onQuickReply?: (message: string, blockKey?: string) => void;
  onCommitmentAccept?: (
    notebookEntryId: number | undefined,
    title: string,
    followUpDate: string,
  ) => void;
  isUsed?: boolean;
  isCommitmentAccepted?: boolean;
  blockKey?: string;
  /** Recipe finder: only the latest assistant message's block is active. */
  isActive?: boolean;
  lockedFinderButtons?: FinderButton[];
  onFinderAction?: (action: FinderAction, label: string) => void;
  onLockedFinderButton?: (button: FinderButton) => void;
  onOpenFinderItem?: (item: FinderItem) => void;
  /** "Make this mine" on a finder idea card. */
  onMakeFinderItem?: (item: FinderItem, flowId: string) => void;
  /** The idea card being made right now, if any. */
  makingFinderItemId?: number | null;
  expiredFinderFlowIds?: ReadonlySet<string>;
  /** The message's text — the recipe offer shows it (the chat hides the
   *  bubble under a finder block). */
  messageContent?: string;
  /** The chat's adjust-card choices by flowId; survives a card remount. */
  adjustChoices?: AdjustChoicesStore;
  /** Fade the block in on mount. Only the live copy of a just-finished
   *  reply sets this; saved messages (history, scroll-back, the swap once
   *  the reply is saved) appear without replaying an entrance. */
  animateEntry?: boolean;
  /** Where this block's entrance starts in the reply's stagger sequence
   *  (`blockEntranceDelays`). */
  entryDelayMs?: number;
  /** Coach write card: the user's edits (owned by the chat) and the setter. */
  writeCardEdits?: WriteCardEdits;
  onWriteCardEdit?: (cardId: string, edits: WriteCardEdits) => void;
}

const noop = () => {};

export default function BlockRenderer({
  animateEntry = false,
  entryDelayMs = 0,
  ...props
}: BlockRendererProps) {
  const { reducedMotion } = useAccessibility();
  const animate = animateEntry && !reducedMotion;
  const content = renderBlock(props, animate, entryDelayMs);

  // A quick-reply row staggers its own chips; everything else enters whole.
  if (!content || !animate || props.block.type === "quick_replies") {
    return content;
  }

  return (
    <Animated.View entering={chatBlockRiseEntrance(entryDelayMs)}>
      {content}
    </Animated.View>
  );
}

function renderBlock(
  {
    block,
    onAction,
    onQuickReply,
    onCommitmentAccept,
    isUsed,
    isCommitmentAccepted,
    blockKey,
    isActive,
    lockedFinderButtons,
    onFinderAction,
    onLockedFinderButton,
    onOpenFinderItem,
    onMakeFinderItem,
    makingFinderItemId,
    expiredFinderFlowIds,
    messageContent,
    adjustChoices,
    writeCardEdits,
    onWriteCardEdit,
  }: Omit<BlockRendererProps, "animateEntry" | "entryDelayMs">,
  animateEntry: boolean,
  entryDelayMs: number,
) {
  switch (block.type) {
    case "action_card":
      return <ActionCard block={block} onAction={onAction} />;
    case "suggestion_list":
      return <SuggestionList block={block} onAction={onAction} />;
    case "inline_chart":
      return <InlineChart block={block} />;
    case "commitment_card":
      return (
        <CommitmentCard
          block={block}
          onAccept={onCommitmentAccept}
          isAccepted={isCommitmentAccepted}
        />
      );
    case "quick_replies":
      return (
        <QuickReplies
          block={block}
          onSelect={onQuickReply}
          blockKey={blockKey}
          used={isUsed}
          animateEntry={animateEntry}
          entryDelayMs={entryDelayMs}
        />
      );
    case "recipe_card":
      return <RecipeCard block={block} onAction={onAction} />;
    case "meal_plan_card":
      return <MealPlanCard block={block} onAction={onAction} />;
    case "write_card":
      return (
        <WriteCard
          block={block}
          edits={writeCardEdits ?? block.edits ?? {}}
          onEdit={(e) => onWriteCardEdit?.(block.cardId, e)}
        />
      );
    case "checked_trail":
      return <CheckedTrail items={block.items} />;
    case "recipe_results":
    case "recipe_questions":
    case "recipe_offer":
    case "recipe_adjust":
      return (
        <RecipeFinderMessage
          block={block}
          content={messageContent}
          adjustChoices={adjustChoices}
          isActive={!!isActive}
          lockedButtons={lockedFinderButtons}
          onAction={onFinderAction ?? noop}
          onLockedButton={onLockedFinderButton ?? noop}
          onOpenItem={onOpenFinderItem ?? noop}
          onMakeItem={onMakeFinderItem}
          makingId={makingFinderItemId}
          expiredFlowIds={expiredFinderFlowIds}
        />
      );
    default:
      return null;
  }
}
