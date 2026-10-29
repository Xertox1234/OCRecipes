import React, { useEffect } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import {
  withOpacity,
  Spacing,
  BorderRadius,
  FontFamily,
} from "@/constants/theme";
import {
  canLog,
  getConfirmFlagPresentation,
  type ConfirmCardState,
} from "@/screens/ScanScreenConfirmOverlay-utils";

interface ScanConfirmOverlayProps {
  confirmCard: ConfirmCardState;
  onDismiss: () => void;
  onLog: () => void;
}

/**
 * The returnAfterLog confirm card shown over the camera after a barcode lock:
 * loading row, then name/calories/flag badge with Dismiss + Log It.
 */
export function ScanConfirmOverlay({
  confirmCard,
  onDismiss,
  onLog,
}: ScanConfirmOverlayProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  // Announce loading state transitions to screen readers (iOS VoiceOver only —
  // Android TalkBack is handled by accessibilityLiveRegion on the loading view).
  // The loaded-name branch also folds in the flag badge (when present): the
  // badge's own `accessibilityLiveRegion` is Android-only, so this imperative
  // announce is iOS's ONLY signal for the flag. Name and flag arrive together
  // in the same buildLoadedConfirmCard transition (a single fetch, not
  // ProductChip's multi-variant lifecycle), so one combined announcement covers
  // both without needing a separate edge-guarded effect.
  const confirmIsLoading = confirmCard.isLoading;
  const confirmIsError = confirmCard.isError;
  const confirmName = confirmCard.name;
  const confirmFlag = confirmCard.topDisplayFlag;
  const confirmFlagTitle = confirmFlag?.title;
  const confirmFlagDetail = confirmFlag?.detail;
  const confirmFlagVisuals = confirmFlag
    ? getConfirmFlagPresentation(confirmFlag)
    : undefined;
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (confirmIsLoading) {
      AccessibilityInfo.announceForAccessibility("Identifying food");
    } else if (confirmIsError) {
      AccessibilityInfo.announceForAccessibility("Nutrition data unavailable");
    } else if (confirmName) {
      const flagSuffix = confirmFlagTitle
        ? ` ${confirmFlagDetail ? `${confirmFlagTitle}. ${confirmFlagDetail}` : confirmFlagTitle}`
        : "";
      AccessibilityInfo.announceForAccessibility(
        `${confirmName}.${flagSuffix}`,
      );
    }
  }, [
    confirmIsLoading,
    confirmIsError,
    confirmName,
    confirmFlagTitle,
    confirmFlagDetail,
  ]);

  return (
    <View
      style={[
        styles.confirmOverlay,
        {
          backgroundColor: withOpacity(theme.backgroundRoot, 0.95),
          paddingBottom: insets.bottom + Spacing.lg,
        },
      ]}
      accessibilityViewIsModal
    >
      {confirmCard.isLoading ? (
        <View style={styles.confirmLoadingRow} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.link} />
          <ThemedText
            style={{ color: theme.textSecondary, marginLeft: Spacing.sm }}
          >
            Identifying food…
          </ThemedText>
        </View>
      ) : (
        <View
          style={[
            styles.confirmCard,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.confirmInfo}>
            {confirmCard.isError ? (
              <>
                <ThemedText
                  type="body"
                  style={{
                    color: theme.textSecondary,
                    fontFamily: FontFamily.semiBold,
                  }}
                  accessibilityLiveRegion="polite"
                >
                  Nutrition data unavailable
                </ThemedText>
                <ThemedText
                  style={{ color: theme.textSecondary, fontSize: 12 }}
                >
                  Barcode: {confirmCard.barcode}
                </ThemedText>
              </>
            ) : (
              <ThemedText
                type="body"
                style={{
                  color: theme.text,
                  fontFamily: FontFamily.semiBold,
                }}
                numberOfLines={2}
                accessibilityLiveRegion="polite"
              >
                {confirmCard.name}
              </ThemedText>
            )}
            {!confirmCard.isError && confirmCard.calories !== null && (
              <ThemedText style={{ color: theme.link, fontSize: 14 }}>
                {confirmCard.calories} cal
              </ThemedText>
            )}
          </View>
          {confirmFlag && confirmFlagVisuals ? (
            <View
              style={[
                styles.confirmFlagBadge,
                {
                  backgroundColor: withOpacity(
                    theme[confirmFlagVisuals.colorKey],
                    0.12,
                  ),
                },
              ]}
              accessible={true}
              accessibilityRole="text"
              accessibilityLiveRegion={confirmFlagVisuals.liveRegion}
              accessibilityLabel={
                confirmFlag.detail
                  ? `${confirmFlag.title}. ${confirmFlag.detail}`
                  : confirmFlag.title
              }
            >
              <Feather
                name={confirmFlagVisuals.icon}
                size={16}
                color={theme[confirmFlagVisuals.colorKey]}
              />
              <ThemedText
                type="small"
                style={{
                  marginLeft: Spacing.sm,
                  fontWeight: "700",
                  color: theme[confirmFlagVisuals.colorKey],
                }}
              >
                {confirmFlag.title}
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.confirmButtons}>
            <Pressable
              onPress={onDismiss}
              disabled={confirmCard.isLogging}
              style={({ pressed }) => [
                styles.confirmDismissButton,
                {
                  borderColor: theme.border,
                  opacity: pressed || confirmCard.isLogging ? 0.5 : 1,
                },
              ]}
              accessibilityLabel="Dismiss"
              accessibilityRole="button"
              accessibilityState={{ disabled: confirmCard.isLogging }}
            >
              <ThemedText style={{ color: theme.textSecondary, fontSize: 14 }}>
                Dismiss
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={onLog}
              disabled={!canLog(confirmCard)}
              style={({ pressed }) => [
                styles.confirmLogButton,
                {
                  backgroundColor: confirmCard.isError
                    ? withOpacity(theme.link, 0.4)
                    : theme.accentSolid,
                  opacity: pressed || confirmCard.isLogging ? 0.7 : 1,
                },
              ]}
              accessibilityLabel={
                confirmCard.isError
                  ? "Log It (unavailable — nutrition data missing)"
                  : "Log It"
              }
              accessibilityRole="button"
              accessibilityState={{
                busy: confirmCard.isLogging,
                disabled: confirmCard.isError,
              }}
            >
              {confirmCard.isLogging ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <ThemedText
                  style={{
                    color: theme.buttonText,
                    fontSize: 14,
                    fontFamily: FontFamily.medium,
                  }}
                >
                  ✓ Log It
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  confirmOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  confirmLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  confirmCard: {
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  confirmInfo: {
    gap: 4,
  },
  confirmFlagBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  confirmDismissButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.xs,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmLogButton: {
    flex: 2,
    borderRadius: BorderRadius.xs,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
});
