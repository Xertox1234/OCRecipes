import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { BorderRadius, Spacing, withOpacity } from "@/constants/theme";
import type { CardUiState } from "./write-card-utils";

interface Props {
  state: CardUiState;
  /** The saved line ("✓ Logged to Breakfast · 226 cal"). */
  receipt?: string;
  /** Show Undo next to the receipt (only just after this device saved). */
  undoVisible: boolean;
  buttonLabel: string;
  /** False when the edits leave nothing to save (every count 0). */
  canSave: boolean;
  error: string | null;
  /** A failed Undo, shown under the receipt. */
  undoError?: string | null;
  onSave: () => void;
  onUndo: () => void;
  /** The card's controls; locked while saving. */
  children: React.ReactNode;
  /** One line for a locked card ("2 items · Breakfast"). */
  lockedSummary: string;
}

const LOCKED_LABEL: Record<"replaced" | "expired", string> = {
  replaced: "Replaced",
  expired: "Expired",
};

/**
 * The frame every Coach write card shares (spec 2026-11-09): live controls
 * with one primary button; a one-line receipt once saved, with Undo for a
 * few seconds; an inline error that keeps the card editable; and a dimmed,
 * untappable card once a newer card replaced it.
 */
export function WriteCardShell(props: Props) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { state } = props;
  const frame = [
    styles.card,
    { backgroundColor: theme.backgroundDefault, borderColor: theme.border },
  ];

  if (state === "replaced" || state === "expired") {
    return (
      <View
        style={[frame, styles.locked]}
        accessible
        accessibilityLabel={`${LOCKED_LABEL[state]} card: ${props.lockedSummary}`}
      >
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {props.lockedSummary}
        </ThemedText>
        <ThemedText
          type="caption"
          style={[styles.lockedTag, { color: theme.textSecondary }]}
        >
          {LOCKED_LABEL[state]}
        </ThemedText>
      </View>
    );
  }

  if (state === "saved") {
    return (
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn}
        style={frame}
      >
        <View style={styles.savedRow}>
          {/* The live region is the receipt alone: on the row it would make
              TalkBack re-read the receipt when Undo leaves. */}
          <ThemedText
            type="small"
            style={[styles.receipt, { color: theme.success }]}
            accessibilityLiveRegion="polite"
          >
            {props.receipt ?? "✓ Saved"}
          </ThemedText>
          {props.undoVisible ? (
            <Button
              variant="ghost"
              onPress={props.onUndo}
              accessibilityLabel="Undo"
            >
              Undo
            </Button>
          ) : null}
        </View>
        {props.undoError ? (
          <InlineError message={props.undoError} style={styles.error} />
        ) : null}
      </Animated.View>
    );
  }

  const saving = state === "saving";
  return (
    <View style={frame}>
      <View
        pointerEvents={saving ? "none" : "auto"}
        style={saving ? styles.busy : undefined}
      >
        {props.children}
      </View>
      {props.error ? (
        <InlineError message={props.error} style={styles.error} />
      ) : null}
      <Button
        onPress={props.onSave}
        loading={saving}
        loadingText="Saving…"
        disabled={!props.canSave || saving}
        accessibilityLabel={props.buttonLabel}
        style={styles.primary}
      >
        {props.buttonLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  locked: { opacity: 0.6 },
  lockedTag: { marginTop: Spacing.xs },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  receipt: { flex: 1 },
  busy: { opacity: 0.6 },
  error: { marginTop: Spacing.sm },
  primary: { marginTop: Spacing.md },
});

/** Exported for the kind bodies: a divider between rows. */
export const rowDivider = (color: string) => ({
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: withOpacity(color, 0.6),
});
