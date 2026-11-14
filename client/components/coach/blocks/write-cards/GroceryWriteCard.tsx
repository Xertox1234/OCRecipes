import React from "react";
import { StyleSheet, View } from "react-native";
import { Chip } from "@/components/Chip";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import type {
  GroceryCardEdits,
  GroceryCardPayload,
} from "@shared/schemas/coach-write-cards";
import { CardCheckRow } from "./CardCheckRow";

interface Props {
  payload: GroceryCardPayload;
  edits: GroceryCardEdits;
  onEdit: (e: GroceryCardEdits) => void;
}

/** The grocery card's controls: a tick per item, then which list. */
export function GroceryWriteCard({ payload, edits, onEdit }: Props) {
  const { theme } = useTheme();
  const ticked = payload.items.map((it, i) => edits.ticked?.[i] ?? it.ticked);
  const list = edits.listId ?? payload.defaultListId ?? "new";

  return (
    <View>
      {payload.items.map((it, i) => (
        <CardCheckRow
          key={`${it.name}-${i}`}
          label={it.name}
          detail={[it.quantity, it.unit].filter(Boolean).join(" ") || undefined}
          checked={ticked[i]}
          onToggle={() => {
            const next = [...ticked];
            next[i] = !next[i];
            onEdit({ ...edits, ticked: next });
          }}
        />
      ))}
      <ThemedText
        type="caption"
        style={[styles.label, { color: theme.textSecondary }]}
      >
        Add to
      </ThemedText>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {payload.lists.map((l) => (
          <Chip
            key={l.id}
            label={l.title}
            variant="outline"
            accessibilityRole="radio"
            selected={list === l.id}
            onPress={() => onEdit({ ...edits, listId: l.id })}
          />
        ))}
        <Chip
          label={`New list (${payload.newListName})`}
          variant="outline"
          accessibilityRole="radio"
          selected={list === "new"}
          onPress={() => onEdit({ ...edits, listId: "new" })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: Spacing.sm },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
});
