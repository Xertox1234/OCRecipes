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
import { FINDER_BUTTON_LABELS, answersLabel } from "./recipe-finder-utils";

export interface RecipeFinderMessageProps {
  block: FinderBlock;
  isActive: boolean;
  /** Passed to the results list; see RecipeResultsListProps. */
  announceArrival?: boolean;
  lockedButtons?: FinderButton[];
  /** `label` is the visible user bubble and the request `content`. */
  onAction: (action: FinderAction, label: string) => void;
  onLockedButton: (button: FinderButton) => void;
  onOpenItem: (item: FinderItem) => void;
}

const NO_LOCKS: FinderButton[] = [];

export function RecipeFinderMessage({
  block,
  isActive,
  announceArrival,
  lockedButtons = NO_LOCKS,
  onAction,
  onLockedButton,
  onOpenItem,
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
  // offer/adjust blocks render nothing until the client UI task
  if (block.type !== "recipe_questions") return null;
  return (
    <RecipeQuestions
      block={block}
      isActive={isActive}
      onSubmit={handleSubmit}
    />
  );
}
