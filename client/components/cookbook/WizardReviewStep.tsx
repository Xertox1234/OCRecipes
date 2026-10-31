import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import { CookbookCoverPlate } from "./CookbookCoverPlate";
import type {
  WizardCover,
  WizardState,
  WizardStep,
} from "./cookbook-wizard-utils";

const PLATE_WIDTH = 150;
const EDIT_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

interface WizardReviewStepProps {
  state: WizardState;
  /** Jumps back to a step the user has already reached. */
  onEdit: (step: WizardStep) => void;
  /** Bumped once the book is created, so the cover plays its success pop. */
  celebrateKey?: number;
}

function coverLabel(cover: WizardCover): string {
  switch (cover.kind) {
    case "photo":
      return "Your photo";
    case "generate":
      return "AI generated";
    case "none":
      return "Plain cloth";
  }
}

/**
 * Wizard step 4: the book as it will be created, with an Edit link back to
 * each earlier step.
 */
export function WizardReviewStep({
  state,
  onEdit,
  celebrateKey,
}: WizardReviewStepProps) {
  const { theme } = useTheme();
  const count = state.recipes.length;
  const { cover } = state;

  return (
    <View style={styles.container}>
      <View style={styles.titleBlock}>
        <ThemedText type="h3" accessibilityRole="header">
          {"Review & create"}
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Everything look right?
        </ThemedText>
      </View>

      <View style={styles.plateBlock}>
        <CookbookCoverPlate
          name={state.name}
          description={state.description}
          previewUri={cover.kind === "photo" ? cover.uri : null}
          generateArmed={cover.kind === "generate"}
          width={PLATE_WIDTH}
          celebrateKey={celebrateKey}
        />
        <ThemedText
          type="caption"
          style={[styles.count, { color: theme.textSecondary }]}
        >
          {count === 1 ? "1 recipe" : `${count} recipes`}
        </ThemedText>
      </View>

      <View style={styles.rows}>
        <ReviewRow
          label="Name"
          value={state.name}
          onEdit={() => onEdit("basics")}
        />
        <ReviewRow
          label="Cover"
          value={coverLabel(cover)}
          onEdit={() => onEdit("cover")}
        />
        <ReviewRow
          label="Recipes"
          value={count === 0 ? "None yet" : `${count} selected`}
          onEdit={() => onEdit("recipes")}
        />
      </View>
    </View>
  );
}

function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.rowText}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          {label}
        </ThemedText>
        <ThemedText style={styles.rowValue} numberOfLines={2}>
          {value}
        </ThemedText>
      </View>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label}`}
        hitSlop={EDIT_HIT_SLOP}
        style={({ pressed }) => [styles.edit, pressed && styles.editPressed]}
      >
        <ThemedText style={[styles.editText, { color: theme.link }]}>
          Edit
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.lg,
  },
  titleBlock: {
    gap: Spacing.xs,
  },
  plateBlock: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  count: {
    textTransform: "uppercase",
    letterSpacing: 1,
    fontFamily: FontFamily.semiBold,
  },
  rows: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowValue: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FontFamily.medium,
  },
  edit: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  editPressed: {
    opacity: 0.6,
  },
  editText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
  },
});
