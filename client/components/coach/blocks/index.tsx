import React from "react";
import type { CoachBlock } from "@shared/schemas/coach-blocks";
import ActionCard from "./ActionCard";
import SuggestionList from "./SuggestionList";
import InlineChart from "./InlineChart";
import CommitmentCard from "./CommitmentCard";
import QuickReplies from "./QuickReplies";
import RecipeCard from "./RecipeCard";
import MealPlanCard from "./MealPlanCard";

interface BlockRendererProps {
  block: CoachBlock;
  onAction?: (action: Record<string, unknown>) => void;
  onQuickReply?: (message: string) => void;
  onCommitmentAccept?: (
    notebookEntryId: number | undefined,
    title: string,
    followUpDate: string,
  ) => void;
  isUsed?: boolean;
  isCommitmentAccepted?: boolean;
}

export default function BlockRenderer({
  block,
  onAction,
  onQuickReply,
  onCommitmentAccept,
  isUsed,
  isCommitmentAccepted,
}: BlockRendererProps) {
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
        <QuickReplies block={block} onSelect={onQuickReply} used={isUsed} />
      );
    case "recipe_card":
      return <RecipeCard block={block} onAction={onAction} />;
    case "meal_plan_card":
      return <MealPlanCard block={block} onAction={onAction} />;
    default:
      return null;
  }
}
