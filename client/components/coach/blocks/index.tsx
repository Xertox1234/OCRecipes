import React from "react";
import Animated, { FadeInDown } from "react-native-reanimated";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import ActionCard from "./ActionCard";
import SuggestionList from "./SuggestionList";
import InlineChart from "./InlineChart";
import CommitmentCard from "./CommitmentCard";
import QuickReplies from "./QuickReplies";
import RecipeCard from "./RecipeCard";
import MealPlanCard from "./MealPlanCard";
import { RecipeFinderMessage } from "@/components/recipe-finder/RecipeFinderMessage";
import { useAccessibility } from "@/hooks/useAccessibility";
import { chatBubbleEntrySpring } from "@/constants/animations";
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
  /** Slide the block in on mount. Only the live copy of a just-finished
   *  reply sets this; saved messages (history, scroll-back, the swap once
   *  the reply is saved) appear without replaying an entrance. */
  animateEntry?: boolean;
}

const noop = () => {};

export default function BlockRenderer({
  animateEntry = false,
  ...props
}: BlockRendererProps) {
  const { reducedMotion } = useAccessibility();
  const content = renderBlock(props);

  if (!content || !animateEntry || reducedMotion) return content;

  return (
    <Animated.View
      entering={FadeInDown.springify()
        .damping(chatBubbleEntrySpring.damping)
        .stiffness(chatBubbleEntrySpring.stiffness)}
    >
      {content}
    </Animated.View>
  );
}

function renderBlock({
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
}: Omit<BlockRendererProps, "animateEntry">) {
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
        />
      );
    case "recipe_card":
      return <RecipeCard block={block} onAction={onAction} />;
    case "meal_plan_card":
      return <MealPlanCard block={block} onAction={onAction} />;
    case "recipe_results":
    case "recipe_questions":
      return (
        <RecipeFinderMessage
          block={block}
          isActive={!!isActive}
          lockedButtons={lockedFinderButtons}
          onAction={onFinderAction ?? noop}
          onLockedButton={onLockedFinderButton ?? noop}
          onOpenItem={onOpenFinderItem ?? noop}
        />
      );
    default:
      return null;
  }
}
