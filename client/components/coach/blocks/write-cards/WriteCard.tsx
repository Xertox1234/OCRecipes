import React, { useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useHaptics } from "@/hooks/useHaptics";
import { useWriteCard } from "@/hooks/useWriteCard";
import { ApiError } from "@/lib/api-error";
import {
  foodCounts,
  groceryKept,
  pantryKept,
  planKept,
  writeCardButtonLabel,
} from "@shared/lib/coach-write-card-math";
import {
  allergenWord,
  type AllergyCardEdits,
  type AllergyCardPayload,
  FoodCardEdits,
  FoodCardPayload,
  GoalsCardEdits,
  GoalsCardPayload,
  GroceryCardEdits,
  GroceryCardPayload,
  PantryCardEdits,
  PantryCardPayload,
  PlanCardEdits,
  PlanCardPayload,
  WriteCardBlock,
  WriteCardEdits,
  WriteCardStatus,
} from "@shared/schemas/coach-write-cards";
import { WriteCardShell } from "./WriteCardShell";
import { AllergyWriteCard } from "./AllergyWriteCard";
import { FoodWriteCard } from "./FoodWriteCard";
import { GoalsWriteCard } from "./GoalsWriteCard";
import { GroceryWriteCard } from "./GroceryWriteCard";
import { PantryWriteCard } from "./PantryWriteCard";
import { PlanWriteCard } from "./PlanWriteCard";
import {
  atOnceUndoShown,
  cardUiState,
  mealChipLabel,
  saveErrorMessage,
} from "./write-card-utils";

interface Props {
  block: WriteCardBlock;
  /** The user's edits, owned by the chat so a chat reply can send them. */
  edits: WriteCardEdits;
  onEdit: (edits: WriteCardEdits) => void;
  /** A chat reply is on its way: the user sent the next message. */
  replyInFlight?: boolean;
  /**
   * The card is in the newest reply (false for an older one; unset for the
   * reply still coming in). Undo on a log applied at once shows only there.
   */
  isActive?: boolean;
}

function canSave(block: WriteCardBlock, edits: WriteCardEdits): boolean {
  switch (block.kind) {
    case "food":
      return foodCounts(
        block.payload as FoodCardPayload,
        edits as FoodCardEdits,
      ).some((c) => c > 0);
    case "grocery":
      return (
        groceryKept(
          block.payload as GroceryCardPayload,
          edits as GroceryCardEdits,
        ).length > 0
      );
    case "plan":
      return (
        planKept(block.payload as PlanCardPayload, edits as PlanCardEdits)
          .length > 0
      );
    case "pantry":
      return (
        pantryKept(block.payload as PantryCardPayload, edits as PantryCardEdits)
          .length > 0
      );
    // Every row always holds a value in bounds; the server refuses a save
    // that changes nothing.
    case "goals":
      return true;
    // The severity is the user's to choose; there is nothing to save before.
    case "allergy":
      return (edits as AllergyCardEdits).severity !== undefined;
  }
}

function lockedSummary(block: WriteCardBlock): string {
  if (block.kind === "food") {
    const p = block.payload as FoodCardPayload;
    return `${p.items.map((i) => i.name).join(", ")} · ${mealChipLabel(p.mealType)}`;
  }
  if (block.kind === "grocery") {
    const n = (block.payload as GroceryCardPayload).items.length;
    return `${n} grocery item${n === 1 ? "" : "s"}`;
  }
  if (block.kind === "pantry") {
    const n = (block.payload as PantryCardPayload).rows.length;
    return `${n} pantry change${n === 1 ? "" : "s"}`;
  }
  if (block.kind === "allergy") {
    return `${allergenWord((block.payload as AllergyCardPayload).allergen)} allergy`;
  }
  if (block.kind === "goals") {
    const n = (block.payload as GoalsCardPayload).rows.length;
    return `${n} daily goal${n === 1 ? "" : "s"}`;
  }
  const n = (block.payload as PlanCardPayload).rows.length;
  return `${n} planned meal${n === 1 ? "" : "s"}`;
}

/**
 * A Coach write card (spec 2026-11-09): the controls for its kind inside the
 * shared shell, with Save, then Undo. Nothing is written until the user taps
 * Save, except a small food log the Coach applied at once (Coach roadmap
 * T2), which arrives saved with Undo. Undo has no timer (WCAG 2.2.1): it stays until the user sends the
 * next message or leaves the screen (the server still refuses it after 60 s).
 */
export default function WriteCard({
  block,
  edits,
  onEdit,
  replyInFlight = false,
  isActive,
}: Props) {
  const haptics = useHaptics();
  const { save, undo } = useWriteCard(block.cardId, block.kind);
  // What this device just did (saved / undone). It wins over the block's
  // status until a refetch catches up — except that a newer card locking
  // this one (replaced / expired) always wins.
  const [localStatus, setStatus] = useState<WriteCardStatus | null>(null);
  const [localReceipt, setReceipt] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  // Undo on a log applied at once (T2) was tapped, or came back too late.
  const [atOnceClosed, setAtOnceClosed] = useState(false);
  const busyRef = useRef(false);
  // Sending the next message ends Undo. Adjusted during render when the
  // prop flips (React's "adjust state when a prop changes" pattern).
  const [prevReplyInFlight, setPrevReplyInFlight] = useState(replyInFlight);
  if (prevReplyInFlight !== replyInFlight) {
    setPrevReplyInFlight(replyInFlight);
    if (replyInFlight) setUndoVisible(false);
  }

  const handleSave = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await save(edits as Record<string, unknown>);
      setReceipt(result.receipt);
      setStatus("saved");
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(result.receipt);
      }
      setUndoVisible(true);
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setError(saveErrorMessage(err));
    }
    // No `finally`: React Compiler cannot lower try/finally and would skip
    // this whole component (check-react-compiler-bailouts.js).
    busyRef.current = false;
    setSaving(false);
  };

  const handleUndo = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setUndoVisible(false);
    setAtOnceClosed(true);
    setUndoError(null);
    try {
      const result = await undo();
      setStatus(result.status);
      // Both platforms: the receipt's live region unmounts with the undo, so
      // nothing else tells TalkBack (and focus goes with the Undo button).
      AccessibilityInfo.announceForAccessibility("Undone");
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setUndoError(saveErrorMessage(err));
      // Too late is final; anything else (a dropped connection) can retry.
      if (!(err instanceof ApiError && err.code === "UNDO_EXPIRED")) {
        setUndoVisible(true);
      }
    }
    busyRef.current = false;
  };

  const status: WriteCardStatus =
    block.status === "replaced" || block.status === "expired"
      ? block.status
      : (localStatus ?? block.status);
  const receipt = localReceipt ?? block.receipt;
  const state = cardUiState(status, { saving, error });
  // A food log the Coach applied at once (T2) arrives saved: Undo with no
  // Save tap, on the newest reply only.
  const showUndo =
    undoVisible ||
    atOnceUndoShown({
      loggedAtOnce: block.loggedAtOnce,
      status,
      isActive,
      replyInFlight,
      closed: atOnceClosed,
    });
  return (
    <WriteCardShell
      state={state}
      receipt={receipt}
      undoVisible={showUndo}
      buttonLabel={writeCardButtonLabel(block.kind, block.payload, edits)}
      canSave={canSave(block, edits)}
      error={status === "saved" ? null : error}
      undoError={status === "saved" ? undoError : null}
      onSave={handleSave}
      onUndo={handleUndo}
      lockedSummary={lockedSummary(block)}
    >
      {block.kind === "food" ? (
        <FoodWriteCard
          payload={block.payload as FoodCardPayload}
          edits={edits as FoodCardEdits}
          onEdit={onEdit}
        />
      ) : block.kind === "grocery" ? (
        <GroceryWriteCard
          payload={block.payload as GroceryCardPayload}
          edits={edits as GroceryCardEdits}
          onEdit={onEdit}
        />
      ) : block.kind === "pantry" ? (
        <PantryWriteCard
          payload={block.payload as PantryCardPayload}
          edits={edits as PantryCardEdits}
          onEdit={onEdit}
        />
      ) : block.kind === "allergy" ? (
        <AllergyWriteCard
          payload={block.payload as AllergyCardPayload}
          edits={edits as AllergyCardEdits}
          onEdit={onEdit}
        />
      ) : block.kind === "goals" ? (
        <GoalsWriteCard
          payload={block.payload as GoalsCardPayload}
          edits={edits as GoalsCardEdits}
          onEdit={onEdit}
        />
      ) : (
        <PlanWriteCard
          payload={block.payload as PlanCardPayload}
          edits={edits as PlanCardEdits}
          onEdit={onEdit}
        />
      )}
    </WriteCardShell>
  );
}
