import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";

interface PasswordConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  /** In flight: inputs and buttons are disabled. */
  busy: boolean;
  /** Static copy from the caller, or null. */
  error: string | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}

/**
 * Asks for the account password before a sensitive change (e.g. connecting a
 * sign-in method). The caller owns the request, `busy` and `error`.
 * RN `Modal` + `TextInput`, never `Alert.prompt` (iOS-only).
 */
export function PasswordConfirmModal({
  visible,
  title,
  message,
  busy,
  error,
  onCancel,
  onSubmit,
}: PasswordConfirmModalProps) {
  const { theme } = useTheme();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Start clean every time it opens.
  useEffect(() => {
    if (visible) {
      setPassword("");
      setShowPassword(false);
    }
  }, [visible]);

  const cancel = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={cancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.kav}
      >
        <Pressable
          // hardcoded — modal backdrops use a fixed dim regardless of theme
          style={[styles.backdrop, { backgroundColor: "rgba(0,0,0,0.55)" }]}
          onPress={cancel}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.center} pointerEvents="box-none">
          <View
            accessibilityViewIsModal
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.border,
              },
            ]}
          >
            <ThemedText type="h4" accessibilityRole="header">
              {title}
            </ThemedText>
            <ThemedText
              type="body"
              style={[styles.message, { color: theme.textSecondary }]}
            >
              {message}
            </ThemedText>
            <TextInput
              leftIcon="lock"
              rightIcon={showPassword ? "eye-off" : "eye"}
              rightIconAccessibilityLabel={
                showPassword ? "Hide password" : "Show password"
              }
              onRightIconPress={() => setShowPassword((s) => !s)}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              editable={!busy}
              accessibilityLabel="Password"
              error={!!error}
            />
            <InlineError message={error} />
            <View style={styles.buttons}>
              <Button
                variant="secondary"
                onPress={cancel}
                disabled={busy}
                style={styles.flex}
              >
                Cancel
              </Button>
              <Button
                onPress={() => onSubmit(password)}
                disabled={!password}
                loading={busy}
                style={styles.flex}
              >
                Continue
              </Button>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject },
  center: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  message: { lineHeight: 20 },
  buttons: { flexDirection: "row", gap: Spacing.md },
  flex: { flex: 1 },
});
