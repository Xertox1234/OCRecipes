// Spec §5 / D1: both chats render THIS component for a finder block —
// RecipeChatScreen from message metadata, Coach's BlockRenderer as a block.
import React, { useCallback } from "react";
import type {
  FinderAction,
  FinderAnswer,
  FinderBlock,
  FinderButton,
  FinderItem,
} from "@shared/schemas/recipe-finder";
import { RecipeResultsList } from "./RecipeResultsList";
import { RecipeQuestions } from "./RecipeQuestions";
import { RecipeOffer } from "./RecipeOffer";
import { RecipeAdjust } from "./RecipeAdjust";
import { FINDER_BUTTON_LABELS, answersLabel } from "./recipe-finder-utils";
import type { AdjustChoicesStore } from "./recipe-offer-utils";

export interface RecipeFinderMessageProps {
  block: FinderBlock;
  /** The message text. Both chats hide it under a finder block; the offer
   *  shows it, since the server wrote the offer copy there. */
  content?: string;
  isActive: boolean;
  /** Passed to the results list; see RecipeResultsListProps. */
  announceArrival?: boolean;
  lockedButtons?: FinderButton[];
  /** `label` is the visible user bubble and the request `content`. */
  onAction: (action: FinderAction, label: string) => void;
  onLockedButton: (button: FinderButton) => void;
  onOpenItem: (item: FinderItem) => void;
  /** The screen's adjust-card choices by flowId; survives a card remount. */
  adjustChoices?: AdjustChoicesStore;
}

const NO_LOCKS: FinderButton[] = [];

export function RecipeFinderMessage({
  block,
  content,
  isActive,
  announceArrival,
  lockedButtons = NO_LOCKS,
  onAction,
  onLockedButton,
  onOpenItem,
  adjustChoices,
}: RecipeFinderMessageProps) {
  // The server mints flowIds; the client only echoes the block's own back.
  const flowId = block.flow.flowId;

  const handleButton = useCallback(
    (button: FinderButton) => {
      if (!isActive) return;
      if (lockedButtons.includes(button)) {
        onLockedButton(button);
        return;
      }
      onAction({ type: button, flowId }, FINDER_BUTTON_LABELS[button]);
    },
    [isActive, lockedButtons, onLockedButton, onAction, flowId],
  );

  const handleSubmit = useCallback(
    (answers: FinderAnswer[]) => {
      if (!isActive || answers.length === 0) return;
      onAction({ type: "answers", flowId, answers }, answersLabel(answers));
    },
    [isActive, onAction, flowId],
  );

  // Offer + adjust buttons send their own action shapes; this gate keeps the
  // "only the latest finder block is live" rule in one place.
  const handleCardAction = useCallback(
    (action: FinderAction, label: string) => {
      if (!isActive) return;
      onAction(action, label);
    },
    [isActive, onAction],
  );

  if (block.type === "recipe_offer") {
    return (
      <RecipeOffer
        block={block}
        content={content}
        isActive={isActive}
        onAction={handleCardAction}
      />
    );
  }
  if (block.type === "recipe_adjust") {
    return (
      <RecipeAdjust
        block={block}
        isActive={isActive}
        onAction={handleCardAction}
        choicesStore={adjustChoices}
      />
    );
  }
  if (block.type === "recipe_results") {
    return (
      <RecipeResultsList
        block={block}
        isActive={isActive}
        announceArrival={announceArrival}
        lockedButtons={lockedButtons}
        onButton={handleButton}
        onOpenItem={onOpenItem}
      />
    );
  }
  return (
    <RecipeQuestions
      block={block}
      isActive={isActive}
      onSubmit={handleSubmit}
    />
  );
}
