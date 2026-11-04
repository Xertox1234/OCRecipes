import React from "react";
import {
  Modal,
  StyleSheet,
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  AbsoluteFill,
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface CenteredDialogProps {
  visible: boolean;
  /** Backdrop tap and the Android back button. The caller guards busy states. */
  onRequestClose: () => void;
  /** Accessibility label of the dimmed backdrop (hidden from VoiceOver). */
  backdropLabel?: string;
  backdropTestID?: string;
  /** Accessibility label of the dialog card. */
  dialogLabel?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  /** Colour of the icon and its circle. */
  iconTone?: "link" | "error";
  title: string;
  message: string;
  /** Space under the message; the default suits a form straight after it. */
  messageGap?: number;
  children: React.ReactNode;
}

/**
 * The dimmed, centered card shared by the re-authentication dialogs (change
 * email, delete account, confirm password): Modal + keyboard avoidance +
 * backdrop + scrollable card with an optional icon, a title and a message.
 * The caller owns everything below the message (fields, errors, buttons).
 */
export function CenteredDialog({
  visible,
  onRequestClose,
  backdropLabel,
  backdropTestID = "centered-dialog-backdrop",
  dialogLabel,
  icon,
  iconTone = "link",
  title,
  message,
  messageGap = Spacing.md,
  children,
}: CenteredDialogProps) {
  const { theme } = useTheme();
  const tone = iconTone === "error" ? theme.error : theme.link;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.kav}
      >
        <Pressable
          style={[
            styles.backdrop,
            // hardcoded — modal backdrops use a fixed dim regardless of theme
            { backgroundColor: "rgba(0,0,0,0.55)" },
          ]}
          onPress={onRequestClose}
          testID={backdropTestID}
          accessibilityLabel={backdropLabel}
          accessibilityRole="button"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.centerWrap} pointerEvents="box-none">
          <View
            accessibilityViewIsModal
            accessibilityLabel={dialogLabel}
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.border,
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              {icon ? (
                <View style={styles.iconContainer}>
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: withOpacity(tone, 0.12) },
                    ]}
                  >
                    <Feather name={icon} size={28} color={tone} />
                  </View>
                </View>
              ) : null}

              <ThemedText
                type="h4"
                accessibilityRole="header"
                style={styles.title}
              >
                {title}
              </ThemedText>

              <ThemedText
                type="body"
                style={[
                  styles.message,
                  { color: theme.textSecondary, marginBottom: messageGap },
                ]}
              >
                {message}
              </ThemedText>

              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: {
    flex: 1,
  },
  backdrop: {
    ...AbsoluteFill,
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "90%",
    borderRadius: BorderRadius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  scrollContent: {
    padding: Spacing.xl,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    textAlign: "center",
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.sm,
  },
  message: {
    textAlign: "center",
    lineHeight: 22,
  },
});
