/**
 * Pure display helpers for LogActionBar. No React or RN dependencies.
 */

/**
 * The subset of `LogGate` (`@/screens/nutrition-detail-utils`) this function
 * needs. Not the exact same type: the real `"open"` variant carries no
 * `buttonLabel` at all, but the real `LogGate` is still assignable here
 * (its `"open"` member satisfies `buttonLabel`'s optionality, its
 * `"needsAcknowledgement"` member matches exactly) — this is the widening
 * `LogActionBar.tsx` relies on to pass its real `logGate` prop straight
 * through without an adapter object.
 */
export type LogBarGate =
  | { kind: "open"; buttonLabel?: string }
  | { kind: "needsAcknowledgement"; buttonLabel: string };

export interface LogBarState {
  mode: "acknowledge" | "log";
  label: string;
  accessibilityLabel: string;
  accessibilityHint: string;
}

/**
 * Which button the sticky bar shows: the acknowledge step for a gated,
 * not-yet-reviewed database fallback, or the ordinary log action once the
 * gate is open (or already acknowledged this render).
 *
 * `deriveLogGate` (`@/screens/nutrition-detail-utils`) owns the gate itself
 * — this only reacts to it. The acknowledge branch echoes back whatever
 * `buttonLabel` the gate produced rather than hardcoding the string, so a
 * future change to that copy doesn't require touching this file too.
 */
export function deriveLogBarState(params: {
  logGate: LogBarGate;
  acknowledged: boolean;
  productName: string | undefined;
}): LogBarState {
  const { logGate, acknowledged, productName } = params;

  if (logGate.kind === "needsAcknowledgement" && !acknowledged) {
    const label = logGate.buttonLabel;
    return {
      mode: "acknowledge",
      label,
      accessibilityLabel: `${label}. These values come from the product database, not the label you photographed.`,
      accessibilityHint: "Reveals the Add to Today button",
    };
  }

  return {
    mode: "log",
    label: "Add to Today",
    accessibilityLabel: `Add ${productName || "item"} to today's food log`,
    accessibilityHint: "Saves this item to your daily nutrition tracking",
  };
}
