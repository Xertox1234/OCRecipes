import React from "react";
import {
  StyleSheet,
  View,
  Modal,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pageSheetHeaderPaddingTop } from "./page-sheet-utils";

import { ThemedText } from "@/components/ThemedText";
import { ModalToastHost } from "@/context/ToastContext";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface PickerSheetProps {
  visible: boolean;
  /** Close button and the platform back/swipe-down both call this. */
  onClose: () => void;
  title: string;
  /** One line under the title (e.g. the item being added). */
  subtitle?: string;
  /** While true the list area shows a spinner instead of `children`. */
  isLoading: boolean;
  /** Spinner colour. */
  accentColor: string;
  /** The list of choices (and its empty state). */
  children: React.ReactNode;
  /** Pinned under the list — usually a `PickerCreateFooter`. */
  footer?: React.ReactNode;
}

/**
 * The page-sheet shell shared by the "save to …" pickers (cookbooks, grocery
 * lists): modal + keyboard avoidance, the header with its close button, a
 * loading row, then the caller's list and footer. Data, rows, empty state and
 * every piece of state stay with the caller.
 */
export function PickerSheet({
  visible,
  onClose,
  title,
  subtitle,
  isLoading,
  accentColor,
  children,
  footer,
}: PickerSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const titleText = <ThemedText style={styles.headerTitle}>{title}</ThemedText>;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        accessibilityViewIsModal
        style={[
          styles.container,
          {
            backgroundColor: theme.backgroundRoot,
            paddingBottom: Math.max(insets.bottom, Spacing.xl) + Spacing.md,
          },
        ]}
      >
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: theme.border,
              paddingTop: pageSheetHeaderPaddingTop(insets.top),
            },
          ]}
        >
          {subtitle === undefined ? (
            titleText
          ) : (
            <View style={styles.headerTextGroup}>
              {titleText}
              <ThemedText
                style={[styles.headerSubtitle, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {subtitle}
              </ThemedText>
            </View>
          )}
          <Pressable
            onPress={onClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={accentColor} />
          </View>
        ) : (
          children
        )}

        {footer}
        <ModalToastHost />
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface PickerCreateFooterProps {
  /** The name input + Create button row, instead of the "New …" button. */
  showInput: boolean;
  onShowInput: () => void;
  /** Whether the "New …" button shows while the input is closed. */
  showNewButton: boolean;
  newButtonLabel: string;
  newButtonAccessibilityLabel: string;
  inputLabel: string;
  placeholder: string;
  name: string;
  onChangeName: (name: string) => void;
  /** Create button and the keyboard's done key. */
  onCreate: () => void;
  isCreating: boolean;
  createAccessibilityLabel: string;
  /** "New …" button border, icon and text. */
  accentColor: string;
  /** Create button fill (carries `theme.buttonText`). */
  fillColor: string;
}

/** The pickers' create-new footer: a "New …" button that opens a name input. */
export function PickerCreateFooter({
  showInput,
  onShowInput,
  showNewButton,
  newButtonLabel,
  newButtonAccessibilityLabel,
  inputLabel,
  placeholder,
  name,
  onChangeName,
  onCreate,
  isCreating,
  createAccessibilityLabel,
  accentColor,
  fillColor,
}: PickerCreateFooterProps) {
  const { theme } = useTheme();

  if (showInput) {
    return (
      <View style={[styles.newInputRow, { borderTopColor: theme.border }]}>
        <FocusTextInput
          label={inputLabel}
          style={[
            styles.newInput,
            {
              color: theme.text,
              borderColor: withOpacity(theme.text, 0.15),
              backgroundColor: withOpacity(theme.text, 0.04),
            },
          ]}
          value={name}
          onChangeText={onChangeName}
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={onCreate}
        />
        <Pressable
          onPress={onCreate}
          disabled={isCreating}
          style={[
            styles.createButton,
            {
              backgroundColor: fillColor,
              opacity: isCreating ? 0.6 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={createAccessibilityLabel}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <ThemedText style={{ color: theme.buttonText }}>Create</ThemedText>
          )}
        </Pressable>
      </View>
    );
  }

  if (!showNewButton) return null;

  return (
    <View style={[styles.footer, { borderTopColor: theme.border }]}>
      <Pressable
        onPress={onShowInput}
        style={[styles.newButton, { borderColor: accentColor }]}
        accessibilityRole="button"
        accessibilityLabel={newButtonAccessibilityLabel}
      >
        <Feather name="plus" size={18} color={accentColor} />
        <ThemedText style={[styles.newButtonText, { color: accentColor }]}>
          {newButtonLabel}
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** Row styles the pickers' list items share. */
export const pickerRowStyles = StyleSheet.create({
  listContent: {
    padding: Spacing.lg,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.sm,
  },
  listItemContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: Spacing.sm,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // 44pt box, not hitSlop. The negative margins keep the header's height at
  // the 24pt icon's (the 16pt vertical padding already leaves room for the
  // box inside the header, so nothing is clipped).
  closeButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: -10,
    marginRight: -10,
  },
  headerTextGroup: {
    flex: 1,
    marginRight: Spacing.md,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    gap: Spacing.sm,
  },
  newButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  newInputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  newInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 14,
  },
  createButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.full,
    minWidth: 80,
    alignItems: "center",
  },
});
