import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { useHaptics } from "@/hooks/useHaptics";
import { useWriteCard } from "@/hooks/useWriteCard";
import {
  foodCounts,
  groceryKept,
  planKept,
  writeCardButtonLabel,
} from "@shared/lib/coach-write-card-math";
import type {
  FoodCardEdits,
  FoodCardPayload,
  GroceryCardPayload,
  PlanCardPayload,
  WriteCardBlock,
  WriteCardEdits,
  WriteCardStatus,
} from "@shared/schemas/coach-write-cards";
import { WriteCardShell } from "./WriteCardShell";
import { FoodWriteCard } from "./FoodWriteCard";
import {
  UNDO_VISIBLE_MS,
  cardUiState,
  mealChipLabel,
  saveErrorMessage,
} from "./write-card-utils";

interface Props {
  block: WriteCardBlock;
  /** The user's edits, owned by the chat so a chat reply can send them. */
  edits: WriteCardEdits;
  onEdit: (edits: WriteCardEdits) => void;
}

function canSave(block: WriteCardBlock, edits: WriteCardEdits): boolean {
  switch (block.kind) {
    case "food":
      return foodCounts(
        block.payload as FoodCardPayload,
        edits as FoodCardEdits,
      ).some((c) => c > 0);
    case "grocery":
      return groceryKept(block.payload as GroceryCardPayload, edits).length > 0;
    case "plan":
      return planKept(block.payload as PlanCardPayload, edits).length > 0;
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
  const n = (block.payload as PlanCardPayload).rows.length;
  return `${n} planned meal${n === 1 ? "" : "s"}`;
}

/**
 * A Coach write card (spec 2026-11-09): the controls for its kind inside the
 * shared shell, with Save and a few seconds of Undo. Nothing is written until
 * the user taps Save.
 */
export default function WriteCard({ block, edits, onEdit }: Props) {
  const haptics = useHaptics();
  const { save, undo } = useWriteCard(block.cardId);
  // What this device just did (saved / undone). It wins over the block's
  // status until a refetch catches up — except that a newer card locking
  // this one (replaced / expired) always wins.
  const [localStatus, setStatus] = useState<WriteCardStatus | null>(null);
  const [localReceipt, setReceipt] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoVisible, setUndoVisible] = useState(false);
  const busyRef = useRef(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

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
      undoTimer.current = setTimeout(
        () => setUndoVisible(false),
        UNDO_VISIBLE_MS,
      );
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setError(saveErrorMessage(err));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const handleUndo = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoVisible(false);
    try {
      const result = await undo();
      setStatus(result.status);
      if (Platform.OS === "ios") {
        AccessibilityInfo.announceForAccessibility("Undone");
      }
    } catch (err) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setError(saveErrorMessage(err));
    } finally {
      busyRef.current = false;
    }
  };

  const status: WriteCardStatus =
    block.status === "replaced" || block.status === "expired"
      ? block.status
      : (localStatus ?? block.status);
  const receipt = localReceipt ?? block.receipt;
  const state = cardUiState(status, { saving, error });
  return (
    <WriteCardShell
      state={state}
      receipt={receipt}
      undoVisible={undoVisible}
      buttonLabel={writeCardButtonLabel(block.kind, block.payload, edits)}
      canSave={canSave(block, edits)}
      error={status === "saved" ? null : error}
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
      ) : null}
    </WriteCardShell>
  );
}
