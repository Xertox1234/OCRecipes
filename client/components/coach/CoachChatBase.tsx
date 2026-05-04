import React, { ReactNode } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { InlineError } from "@/components/InlineError";

interface CoachChatBaseProps {
  /** Slot rendered above the message list (header, close button, etc). */
  header?: ReactNode;
  /** The message list (FlatList or ScrollView). Must fill available space. */
  children: ReactNode;
  /** Current text-input value. */
  inputText: string;
  onChangeText: (text: string) => void;
  /** Called when the user presses send or submits via keyboard. */
  onSend: () => void;
  /** Whether a stream is active (disables the input). */
  isStreaming: boolean;
  /** When false the send button is visually dimmed and disabled. Defaults to inputText.trim().length > 0. */
  canSend?: boolean;
  /** Placeholder text for the text input. */
  placeholder?: string;
  /** Accessibility label for the text input. */
  inputAccessibilityLabel?: string;
  /** Node rendered inside the input bar to the right of the TextInput when
   *  the send button is hidden (e.g. a mic button). */
  inputAdornment?: ReactNode;
  /** Whether the TextInput should support multiple lines. Defaults to false. */
  multilineInput?: boolean;
  /** keyboardVerticalOffset for KeyboardAvoidingView. Defaults to 0. */
  keyboardVerticalOffset?: number;
  /** Vertical alignment of items inside the input bar. Use "flex-end" when
   *  multilineInput is true so the send button stays bottom-aligned. */
  inputBarAlign?: "center" | "flex-end";
  /** Extra style for the input bar (e.g. paddingBottom for safe-area). */
  inputBarStyle?: StyleProp<ViewStyle>;
  /** Inline error message shown below the input bar. */
  streamingError?: string | null;
  /** Inline banner shown below the input bar in place of (or alongside) the error. */
  inlineBanner?: ReactNode;
  /** Additional style for the outer KAV container. */
  containerStyle?: StyleProp<ViewStyle>;
  /** When false the entire input bar is hidden. Defaults to true. */
  showInputBar?: boolean;
  /** Pass true when this component is rendered inside a modal to enable
   *  proper focus trapping for screen readers. */
  accessibilityViewIsModal?: boolean;
}

/**
 * Shared structural shell used by both CoachChat (full-screen FlatList view)
 * and CoachOverlayContent (modal ScrollView view).
 *
 * Provides:
 *  - KeyboardAvoidingView wrapper
 *  - Optional header slot
 *  - Message list area (children)
 *  - Input bar (TextInput + send button, optional adornment)
 *  - InlineError banner below the input bar
 */
export function CoachChatBase({
  header,
  children,
  inputText,
  onChangeText,
  onSend,
  isStreaming,
  canSend: canSendProp,
  placeholder = "Ask your coach...",
  inputAccessibilityLabel = "Message your nutrition coach",
  inputAdornment,
  multilineInput = false,
  keyboardVerticalOffset = 0,
  inputBarAlign = "center",
  inputBarStyle,
  streamingError,
  inlineBanner,
  containerStyle,
  showInputBar = true,
  accessibilityViewIsModal,
}: CoachChatBaseProps) {
  const { theme } = useTheme();

  const canSend =
    canSendProp !== undefined
      ? canSendProp
      : inputText.trim().length > 0 && !isStreaming;

  const showSendButton = inputText.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={[styles.container, containerStyle]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={keyboardVerticalOffset}
      accessibilityViewIsModal={accessibilityViewIsModal}
    >
      {header}

      {/* Message list — fills remaining space */}
      <View style={styles.listContainer}>{children}</View>

      {/* Input bar */}
      {showInputBar && (
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: theme.backgroundSecondary,
              borderTopColor: theme.border,
              alignItems: inputBarAlign,
              padding: Spacing.sm,
            },
            inputBarStyle,
          ]}
        >
          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.backgroundDefault, color: theme.text },
            ]}
            placeholder={placeholder}
            placeholderTextColor={theme.textSecondary}
            value={inputText}
            onChangeText={onChangeText}
            onSubmitEditing={onSend}
            returnKeyType="send"
            multiline={multilineInput}
            blurOnSubmit={!multilineInput}
            editable={!isStreaming}
            accessibilityLabel={inputAccessibilityLabel}
            maxLength={2000}
          />
          {showSendButton ? (
            <Pressable
              style={[
                styles.sendBtn,
                {
                  backgroundColor: canSend
                    ? theme.link
                    : withOpacity(theme.link, 0.3),
                },
              ]}
              onPress={onSend}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend }}
            >
              <Feather name="send" size={16} color={theme.buttonText} />
            </Pressable>
          ) : (
            (inputAdornment ?? null)
          )}
        </View>
      )}

      {streamingError ? (
        <InlineError message={streamingError} style={styles.inlineError} />
      ) : null}
      {inlineBanner ?? null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContainer: { flex: 1 },
  inputBar: {
    flexDirection: "row",
    gap: Spacing.sm,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineError: {
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
    padding: Spacing.sm,
  },
});
