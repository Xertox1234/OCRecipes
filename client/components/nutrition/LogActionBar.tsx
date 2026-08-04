import React, { useEffect, useState } from "react";
import { StyleSheet, View, AccessibilityInfo } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import type { LogGate } from "@/screens/nutrition-detail-utils";
import { deriveLogBarState } from "./LogActionBar-utils";

interface LogActionBarProps {
  logGate: LogGate;
  productName: string | undefined;
  isOffline: boolean;
  offlineLabel: (label: string) => string;
  isPending: boolean;
  onAddToLog: () => void;
  onLayout: (height: number) => void;
}

/**
 * The sticky bottom action bar that replaces the inline "Add to Today"
 * button. Owns the log-gate acknowledgement flow and its own bottom
 * safe-area inset — mounted (Task 8) as an absolutely-positioned sibling
 * AFTER the screen's ScrollView, INSIDE the same `accessibilityViewIsModal`
 * root, so it stays in the modal's iOS accessibility scope.
 *
 * No entrance animation: this is the screen's primary call-to-action and
 * must stay immediately actionable the moment the screen renders, unlike
 * the passive info panels above it that fade in on a staggered ladder.
 */
export function LogActionBar({
  logGate,
  productName,
  isOffline,
  offlineLabel,
  isPending,
  onAddToLog,
  onLayout,
}: LogActionBarProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  // Reset whenever the gate changes OR the product does, so an acknowledgement
  // can never carry over onto different numbers.
  //
  // `logGate.kind` alone is insufficient: it is two-valued, so any transition that
  // swaps `nutrition` while leaving the gate gated keeps the acknowledgement alive.
  // The manual-search flow is that transition — the user acknowledges a numberless
  // "Product Not Found" screen, then searches up a different food and
  // `handleManualSearch` replaces `nutrition` without touching `labelUsed`.
  //
  // Not user-reachable in this tree today: nothing emits the `notInDatabase` flag
  // that opens `showManualSearch` (no server hit for it, and `sendError` sends only
  // `{ error, code }`), so this guards a real state-machine defect ahead of the
  // emitter rather than a live bug. It is cheap and must not regress if that
  // branch is ever wired up.
  //
  // `productName` is the dep that actually discriminates. `barcode` does NOT: the
  // not-found branch sets `barcode: code` and `handleManualSearch` sets
  // `barcode: barcode || undefined` — the same route barcode both times — so it is
  // invariant across exactly the transition this guards. `productName` goes
  // "Product Not Found" → the searched food's name, and it also survives
  // `recalculateNutrition` untouched, so a user-initiated serving edit does not
  // needlessly discard an acknowledgement about the same product.
  //
  // Keyed on those two PRIMITIVE fields, not on `logGate`/`nutrition` themselves —
  // the hook returns fresh objects each render, so depending on them would re-fire
  // every render and wipe the acknowledgement the instant it was given, leaving
  // the log button permanently unreachable.
  const [acknowledgedUnverified, setAcknowledgedUnverified] = useState(false);
  useEffect(() => {
    setAcknowledgedUnverified(false);
  }, [logGate.kind, productName]);

  const state = deriveLogBarState({
    logGate,
    acknowledged: acknowledgedUnverified,
    productName,
  });

  return (
    <View
      testID="log-action-bar"
      onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom + Spacing.md,
          backgroundColor: theme.backgroundRoot,
          borderTopColor: theme.border,
        },
      ]}
    >
      {state.mode === "acknowledge" ? (
        <Button
          onPress={() => {
            setAcknowledgedUnverified(true);
            // Both branches render the same Button at the same JSX position
            // with no key, so React swaps props on ONE node and the screen
            // reader keeps focus there. A changed accessibilityLabel on an
            // already-focused element is not re-spoken, so without this a
            // screen-reader user hears nothing, re-activates the same node
            // out of habit, and logs the un-reviewed database numbers having
            // never perceived the gate. Announcing beats a `key` remount,
            // which would drop focus and still guarantee nothing.
            AccessibilityInfo.announceForAccessibility(
              "Values confirmed. Add to Today is now available.",
            );
          }}
          accessibilityLabel={state.accessibilityLabel}
          accessibilityHint={state.accessibilityHint}
          style={styles.addButton}
        >
          {state.label}
        </Button>
      ) : (
        <Button
          onPress={onAddToLog}
          loading={isPending}
          accessibilityLabel={offlineLabel(state.accessibilityLabel)}
          accessibilityHint={state.accessibilityHint}
          style={styles.addButton}
        >
          {offlineLabel(state.label)}
        </Button>
      )}
      {isOffline && (
        <ThemedText
          type="small"
          style={[styles.offlineCaption, { color: theme.textSecondary }]}
        >
          You&apos;re offline. This will sync when you reconnect.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolutely positioned so it sits over the ScrollView's tail rather than
  // scrolling with it — the bar owns `insets.bottom` (added at render, above)
  // so the ScrollView must NOT also pad for it (Task 8's half of that
  // contract). `borderTopWidth`/`backgroundColor` (set alongside
  // `paddingBottom` above, since they're theme-dependent) exist so scrolled
  // content doesn't show through behind the bar — not decorative, load-bearing
  // for the "sticky" behaviour this component exists to provide.
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
  // Moved from NutritionDetailScreen.tsx:878-880, unchanged.
  addButton: {
    marginBottom: Spacing.md,
  },
  // Moved from NutritionDetailScreen.tsx's inline offline-caption style,
  // unchanged (`color` stays inline — theme-dependent).
  offlineCaption: {
    textAlign: "center",
    marginTop: Spacing.xs,
  },
});
