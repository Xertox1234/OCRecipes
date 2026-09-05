import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, StyleSheet, View, Pressable } from "react-native";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useSheetBackHandler } from "@/hooks/useSheetBackHandler";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  getConfirmButtonStyle,
  getCancelButtonStyle,
  getDefaultLabels,
} from "./confirmation-modal-utils";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  destructive?: boolean;
}

/**
 * Hook providing a themed confirmation bottom sheet.
 *
 * Usage:
 * ```
 * const { confirm, ConfirmationModal } = useConfirmationModal();
 * confirm({ title: "Delete?", message: "...", onConfirm: () => {} });
 * // render <ConfirmationModal /> once at bottom of JSX
 * ```
 */
export function useConfirmationModal() {
  const sheetRef = useRef<BottomSheetModal>(null);
  const optionsRef = useRef<ConfirmOptions | null>(null);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setRevision] = useState(0);

  const confirm = useCallback((opts: ConfirmOptions) => {
    optionsRef.current = opts;
    setRevision((r) => r + 1);
    sheetRef.current?.present();
    // Announce the sheet's purpose on open — same pattern and rationale as
    // UpgradeModal: without it the only screen-reader feedback is the present
    // focus shift, with no context for why the sheet appeared. This matters
    // doubly here since the sheet replaced native Alert.alert call sites
    // (issue #908), whose title/message the OS read aloud for free. Delayed
    // ~500ms (past the slide-present animation) so iOS VoiceOver doesn't
    // swallow it mid screen-change; cleared on dismiss (ConfirmationModalInner)
    // and unmount so a sheet closed within the delay stays silent.
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility(
        `${opts.title}. ${opts.message}`,
      );
    }, 500);
  }, []);

  useEffect(
    () => () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    },
    [],
  );

  // Stable component identity — never changes, so React re-renders (not remounts)
  const ConfirmationModal = useMemo(
    () =>
      function StableConfirmationModal() {
        return (
          <ConfirmationModalInner
            sheetRef={sheetRef}
            optionsRef={optionsRef}
            announceTimerRef={announceTimerRef}
          />
        );
      },
    [],
  );

  return { confirm, ConfirmationModal };
}

// --- Inner component ---

interface ConfirmationModalInnerProps {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  optionsRef: React.RefObject<ConfirmOptions | null>;
  announceTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}

const MAX_DYNAMIC_HEIGHT = 350;

function ConfirmationModalInner({
  sheetRef,
  optionsRef,
  announceTimerRef,
}: ConfirmationModalInnerProps) {
  const options = optionsRef.current;
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const insets = useSafeAreaInsets();
  const isActioning = useRef(false);

  const destructive = options?.destructive ?? false;
  const defaults = getDefaultLabels(destructive);
  const confirmLabel = options?.confirmLabel ?? defaults.confirmLabel;
  const cancelLabel = options?.cancelLabel ?? defaults.cancelLabel;
  const confirmStyle = getConfirmButtonStyle(destructive, theme);
  const cancelStyle = getCancelButtonStyle(theme);

  const handleDismiss = useCallback(() => {
    // A sheet dismissed within the announce delay stays silent — see the
    // announce comment in useConfirmationModal's confirm().
    if (announceTimerRef.current) {
      clearTimeout(announceTimerRef.current);
      announceTimerRef.current = null;
    }
    if (!isActioning.current) {
      optionsRef.current?.onCancel?.();
    }
    isActioning.current = false;
  }, [optionsRef, announceTimerRef]);

  // Imperative host — see useSheetBackHandler's JSDoc for onSheetChange/onSheetAnimate semantics.
  const { onSheetChange, onSheetAnimate } = useSheetBackHandler(sheetRef);

  const handleConfirm = useCallback(() => {
    if (isActioning.current) return;
    isActioning.current = true;

    if (optionsRef.current?.destructive) {
      haptics.notification(NotificationFeedbackType.Warning);
    } else {
      haptics.impact(ImpactFeedbackStyle.Medium);
    }

    optionsRef.current?.onConfirm();
    sheetRef.current?.dismiss();
  }, [haptics, optionsRef, sheetRef]);

  const handleCancel = useCallback(() => {
    if (isActioning.current) return;
    sheetRef.current?.dismiss();
  }, [sheetRef]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.35}
        pressBehavior="close"
      />
    ),
    [],
  );

  const animationConfigs = reducedMotion ? { duration: 0 } : undefined;

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      maxDynamicContentSize={MAX_DYNAMIC_HEIGHT}
      backdropComponent={renderBackdrop}
      onDismiss={handleDismiss}
      onChange={onSheetChange}
      onAnimate={onSheetAnimate}
      accessibilityViewIsModal
      handleIndicatorStyle={{ display: "none" }}
      backgroundStyle={{ backgroundColor: theme.backgroundDefault }}
      animationConfigs={animationConfigs}
    >
      <BottomSheetView>
        <View
          style={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {/* Drag indicator */}
          <View
            style={[
              styles.dragIndicator,
              { backgroundColor: withOpacity(theme.text, 0.2) },
            ]}
          />

          {/* Warning icon (destructive only) — decorative: it repeats nothing
              beyond the title/message that follow, so hide it from the a11y
              tree with the full container pair (a bare accessible={false}
              leaves the subtree in Android's tree). */}
          {destructive && (
            <View
              style={styles.iconContainer}
              testID="confirmation-modal-destructive-icon"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Feather name="alert-triangle" size={28} color={theme.error} />
            </View>
          )}

          {/* Title */}
          <ThemedText type="h4" style={styles.title} accessibilityRole="header">
            {options?.title ?? ""}
          </ThemedText>

          {/* Message */}
          <ThemedText
            type="body"
            style={[styles.message, { color: theme.textSecondary }]}
          >
            {options?.message ?? ""}
          </ThemedText>

          {/* Button row */}
          <View style={styles.buttonRow}>
            <Pressable
              onPress={handleCancel}
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              style={[
                styles.button,
                { backgroundColor: cancelStyle.backgroundColor },
              ]}
            >
              <ThemedText
                type="body"
                style={[styles.buttonText, { color: cancelStyle.textColor }]}
              >
                {cancelLabel}
              </ThemedText>
            </Pressable>

            <Pressable
              onPress={handleConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              style={[
                styles.button,
                { backgroundColor: confirmStyle.backgroundColor },
              ]}
            >
              <ThemedText
                type="body"
                style={[styles.buttonText, { color: confirmStyle.textColor }]}
              >
                {confirmLabel}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    alignItems: "center",
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.lg,
  },
  iconContainer: {
    marginBottom: Spacing.md,
  },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: 18,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  message: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
    lineHeight: 22,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.md,
    width: "100%",
  },
  button: {
    flex: 1,
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.button,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
});
