import React, { useEffect, useState } from "react";
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
  remindersValues,
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
  REMINDER_LABELS,
  type FamilyCardEdits,
  type FamilyCardPayload,
  type RemindersCardEdits,
  type RemindersCardPayload,
  WriteCardBlock,
  WriteCardEdits,
  WriteCardStatus,
} from "@shared/schemas/coach-write-cards";
import { WriteCardShell } from "./WriteCardShell";
import {
  effectiveCardStatus,
  getWriteCardSession,
  updateWriteCardSession,
  useWriteCardSession,
  type WriteCardSession,
} from "./write-card-session";
import { AllergyWriteCard } from "./AllergyWriteCard";
import { FoodWriteCard } from "./FoodWriteCard";
import { GoalsWriteCard } from "./GoalsWriteCard";
import { GroceryWriteCard } from "./GroceryWriteCard";
import { PantryWriteCard } from "./PantryWriteCard";
import { PlanWriteCard } from "./PlanWriteCard";
import { RemindersWriteCard } from "./RemindersWriteCard";
import { FamilyWriteCard } from "./FamilyWriteCard";
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
    // At least one switch left the way the Coach proposed: a card with every
    // row switched back would change nothing.
    case "reminders": {
      const p = block.payload as RemindersCardPayload;
      return remindersValues(p, edits as RemindersCardEdits).some(
        (v, i) => v === p.changes[i].on,
      );
    }
    // Every allergy's severity is the user's to choose, as on the allergy card.
    case "family": {
      const p = block.payload as FamilyCardPayload;
      const picked = (edits as FamilyCardEdits).severities ?? [];
      return p.allergens.every((_, i) => picked[i] != null);
    }
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
  if (block.kind === "family") {
    return `${(block.payload as FamilyCardPayload).name}, family member`;
  }
  if (block.kind === "reminders") {
    return (block.payload as RemindersCardPayload).changes
      .map((c) => REMINDER_LABELS[c.key])
      .join(", ");
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
  // What this device did (saving, saved, undone, an error) lives in a store
  // keyed by cardId, so it survives the footer-to-saved-row remount (L34).
  const session = useWriteCardSession(block.cardId);
  const update = (patch: Partial<WriteCardSession>) =>
    updateWriteCardSession(block.cardId, patch);
  // A card that mounts already saved (a log applied at once, the saved copy
  // taking over from the streamed one, a reopened chat) does not fade in:
  // only a save made on this card does.
  const [mountedSaved] = useState(
    () =>
      effectiveCardStatus(block.status, getWriteCardSession(block.cardId)) ===
      "saved",
  );
  // Sending the next message ends Undo, also for a log applied at once (a
  // failed send does not bring it back).
  useEffect(() => {
    if (replyInFlight) {
      updateWriteCardSession(block.cardId, {
        undoVisible: false,
        atOnceClosed: true,
      });
    }
  }, [replyInFlight, block.cardId]);

  const handleSave = async () => {
    // Read the store, not this render: another copy may have started a save.
    if (getWriteCardSession(block.cardId).busy) return;
    update({ busy: true, saving: true, error: null });
    const actedOn = block.status;
    try {
      const result = await save(edits as Record<string, unknown>);
      update({ receipt: result.receipt, status: "saved", actedOn });
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility(result.receipt);
      }
      update({ undoVisible: true });
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      update({ error: saveErrorMessage(err) });
    }
    // No `finally`: React Compiler cannot lower try/finally and would skip
    // this whole component (check-react-compiler-bailouts.js).
    update({ busy: false, saving: false });
  };

  const handleUndo = async () => {
    if (getWriteCardSession(block.cardId).busy) return;
    update({
      busy: true,
      undoVisible: false,
      atOnceClosed: true,
      undoError: null,
    });
    const actedOn = effectiveCardStatus(
      block.status,
      getWriteCardSession(block.cardId),
    );
    try {
      const result = await undo();
      update({ status: result.status, actedOn });
      // Both platforms: the receipt's live region unmounts with the undo, so
      // nothing else tells TalkBack (and focus goes with the Undo button).
      AccessibilityInfo.announceForAccessibility("Undone");
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      update({ undoError: saveErrorMessage(err) });
      // Too late is final; anything else (a dropped connection) can retry.
      if (!(err instanceof ApiError && err.code === "UNDO_EXPIRED")) {
        update({ undoVisible: true });
      }
    }
    update({ busy: false });
  };

  const status: WriteCardStatus = effectiveCardStatus(block.status, session);
  const receipt = session.receipt ?? block.receipt;
  const { saving, error, undoError, undoVisible, atOnceClosed } = session;
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
      fadeInSaved={!mountedSaved}
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
      ) : block.kind === "family" ? (
        <FamilyWriteCard
          payload={block.payload as FamilyCardPayload}
          edits={edits as FamilyCardEdits}
          onEdit={onEdit}
        />
      ) : block.kind === "reminders" ? (
        <RemindersWriteCard
          payload={block.payload as RemindersCardPayload}
          edits={edits as RemindersCardEdits}
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
