import React, { useCallback, useRef, useState } from "react";
import { StyleSheet, View, Pressable } from "react-native";
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
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    sheetRef.current?.present();
  }, []);

  const ConfirmationModal = useCallback(
    () => <ConfirmationModalInner sheetRef={sheetRef} options={options} />,
    [options],
  );

  return { confirm, ConfirmationModal };
}

// --- Inner component ---

interface ConfirmationModalInnerProps {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  options: ConfirmOptions | null;
}

const MAX_DYNAMIC_HEIGHT = 350;

function ConfirmationModalInnerBase({
  sheetRef,
  options,
}: ConfirmationModalInnerProps) {
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
    if (!isActioning.current) {
      options?.onCancel?.();
    }
    isActioning.current = false;
  }, [options]);

  const handleConfirm = useCallback(() => {
    if (isActioning.current) return;
    isActioning.current = true;

    if (destructive) {
      haptics.notification(NotificationFeedbackType.Warning);
    } else {
      haptics.impact(ImpactFeedbackStyle.Medium);
    }

    options?.onConfirm();
    sheetRef.current?.dismiss();
  }, [destructive, haptics, options, sheetRef]);

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

          {/* Warning icon (destructive only) */}
          {destructive && (
            <View style={styles.iconContainer}>
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

const ConfirmationModalInner = React.memo(ConfirmationModalInnerBase);

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
