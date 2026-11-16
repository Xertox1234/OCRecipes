import React from "react";
import { View } from "react-native";
import {
  PANTRY_ACTION_LABEL,
  pantryRowAmount,
} from "@shared/lib/coach-write-card-math";
import type {
  PantryCardEdits,
  PantryCardPayload,
} from "@shared/schemas/coach-write-cards";
import { CardCheckRow } from "./CardCheckRow";

interface Props {
  payload: PantryCardPayload;
  edits: PantryCardEdits;
  onEdit: (e: PantryCardEdits) => void;
}

/**
 * The pantry card's controls (spec 2026-11-16): one tick per change. The
 * action is a word on every row, never a colour alone, and the amounts are
 * the server's; a wrong amount is fixed by telling Coach.
 */
export function PantryWriteCard({ payload, edits, onEdit }: Props) {
  const ticked = payload.rows.map((_, i) => edits.ticked?.[i] ?? true);

  return (
    <View>
      {payload.rows.map((row, i) => (
        <CardCheckRow
          key={`${row.action}-${row.itemId ?? row.name}-${i}`}
          tag={PANTRY_ACTION_LABEL[row.action]}
          label={row.name}
          detail={pantryRowAmount(row) || undefined}
          checked={ticked[i]}
          onToggle={() => {
            const next = [...ticked];
            next[i] = !next[i];
            onEdit({ ...edits, ticked: next });
          }}
        />
      ))}
    </View>
  );
}
