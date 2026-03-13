import React, { useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { usePurchase } from "@/lib/iap/usePurchase";
import { isPurchaseInProgress } from "@/lib/subscription/type-guards";
import { BENEFITS, getCtaLabel, isCtaDisabled } from "./upgrade-modal-utils";

interface UpgradeModalProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade?: () => void;
}

export function UpgradeModal({
  visible,
  onClose,
  onUpgrade,
}: UpgradeModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const { state, purchase, restore, reset } = usePurchase();
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accentColor = theme.success;
  const inProgress = isPurchaseInProgress(state);

  // Auto-close on success after 1.5s
  useEffect(() => {
    if (state.status === "success") {
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      autoCloseTimer.current = setTimeout(() => {
        onUpgrade?.();
        onClose();
        reset();
      }, 1500);
    }
    return () => {
      if (autoCloseTimer.current) {
        clearTimeout(autoCloseTimer.current);
      }
    };
  }, [state.status, onUpgrade, onClose, reset, haptics]);

  // Reset cancelled immediately; reset error when modal re-opens
  useEffect(() => {
    if (state.status === "cancelled") {
      reset();
    } else if (visible && state.status === "error") {
      reset();
    }
  }, [visible, state.status, reset]);

  const handleUpgrade = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    purchase();
  }, [haptics, purchase]);

  const handleRestore = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    restore();
  }, [haptics, restore]);

  const handleClose = useCallback(() => {
    if (!inProgress) {
      onClose();
    }
  }, [inProgress, onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
        <View
          accessibilityViewIsModal
          style={[
            styles.container,
            {
              backgroundColor: theme.backgroundDefault,
              paddingBottom: insets.bottom + Spacing.lg,
            },
          ]}
        >
          {/* Close button */}
          <Pressable
            onPress={handleClose}
            disabled={inProgress}
            accessibilityLabel="Close upgrade modal"
            accessibilityRole="button"
            hitSlop={12}
            style={[styles.closeButton, inProgress && styles.disabledButton]}
          >
            <Feather
              name="x"
              size={24}
              color={
                inProgress
                  ? withOpacity(theme.textSecondary, 0.5)
                  : theme.textSecondary
              }
            />
          </Pressable>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Header */}
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: withOpacity(accentColor, 0.12) },
              ]}
            >
              {state.status === "success" ? (
                <Feather name="check-circle" size={32} color={accentColor} />
              ) : (
                <Feather name="star" size={32} color={accentColor} />
              )}
            </View>
            <ThemedText type="h3" style={styles.title}>
              {state.status === "success"
                ? "Welcome to Premium!"
                : "Upgrade to Premium"}
            </ThemedText>
            <ThemedText
              type="body"
              style={[styles.subtitle, { color: theme.textSecondary }]}
            >
              {state.status === "success"
                ? "All premium features are now unlocked"
                : "Unlock the full OCRecipes experience"}
            </ThemedText>

            {/* Benefits */}
            <Card elevation={1} style={styles.benefitsCard}>
              {BENEFITS.map((benefit, index) => (
                <View
                  key={benefit.label}
                  style={[
                    styles.benefitRow,
                    index < BENEFITS.length - 1 && styles.benefitRowBorder,
                    index < BENEFITS.length - 1 && {
                      borderBottomColor: theme.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.benefitIcon,
                      { backgroundColor: withOpacity(accentColor, 0.12) },
                    ]}
                  >
                    <Feather
                      name={benefit.icon}
                      size={18}
                      color={accentColor}
                    />
                  </View>
                  <ThemedText type="body" style={styles.benefitLabel}>
                    {benefit.label}
                  </ThemedText>
                  <Feather name="check" size={18} color={accentColor} />
                </View>
              ))}
            </Card>

            {/* CTA */}
            <Pressable
              onPress={handleUpgrade}
              disabled={isCtaDisabled(state.status)}
              accessibilityLabel="Start 3-day free trial"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.ctaButton,
                {
                  backgroundColor: accentColor,
                  opacity: isCtaDisabled(state.status)
                    ? 0.6
                    : pressed
                      ? 0.85
                      : 1,
                },
              ]}
            >
              {inProgress ? (
                <ActivityIndicator color={theme.buttonText} size="small" />
              ) : (
                <ThemedText
                  type="body"
                  style={[styles.ctaText, { color: theme.buttonText }]}
                >
                  {getCtaLabel(state.status)}
                </ThemedText>
              )}
            </Pressable>

            {/* Error message */}
            {state.status === "error" ? (
              <View style={styles.errorContainer}>
                <ThemedText
                  type="small"
                  style={[styles.errorText, { color: theme.error }]}
                >
                  {state.error.message}
                </ThemedText>
                <Pressable
                  onPress={handleUpgrade}
                  accessibilityLabel="Try again"
                  accessibilityRole="button"
                >
                  <ThemedText
                    type="small"
                    style={[styles.tryAgainText, { color: accentColor }]}
                  >
                    Try Again
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            {/* Restore */}
            <Pressable
              onPress={handleRestore}
              disabled={inProgress}
              accessibilityLabel="Restore purchases"
              accessibilityRole="button"
              style={[
                styles.restoreButton,
                inProgress && styles.disabledButton,
              ]}
            >
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Restore Purchases
              </ThemedText>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    maxHeight: "85%",
  },
  closeButton: {
    alignSelf: "flex-end",
    padding: Spacing.xs,
  },
  scrollContent: {
    alignItems: "center",
    paddingBottom: Spacing.md,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  subtitle: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  benefitsCard: {
    width: "100%",
    marginBottom: Spacing.xl,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  benefitRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  benefitLabel: {
    flex: 1,
  },
  ctaButton: {
    width: "100%",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  ctaText: {
    fontWeight: "600",
  },
  errorContainer: {
    marginTop: Spacing.sm,
    alignItems: "center",
    gap: Spacing.xs,
  },
  errorText: {
    textAlign: "center",
  },
  tryAgainText: {
    fontWeight: "600",
  },
  restoreButton: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    justifyContent: "center",
  },
  disabledButton: {
    opacity: 0.4,
  },
});
