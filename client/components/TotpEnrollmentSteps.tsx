import React, { useState } from "react";
import {
  AccessibilityInfo,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { ApiError } from "@/lib/api-error";
import { normalizeCodeInput } from "@/lib/second-factor-utils";
import { BorderRadius, Spacing } from "@/constants/theme";
import {
  canFinishSaveCodes,
  formatSetupKey,
  recoveryCodesText,
  shouldGuardLeave,
} from "@/screens/TwoStepSetupScreen-utils";

export type TotpEnrollmentStart =
  | { kind: "secret"; secret: { secret: string; otpauthUrl: string } }
  /** New recovery codes: straight to the save step. */
  | { kind: "codes"; codes: string[] };

interface TotpEnrollmentStepsProps {
  start: TotpEnrollmentStart;
  /**
   * Checks the 6-digit code. Resolves with recovery codes on a first setup,
   * undefined on a new phone. Rejects with an ApiError.
   */
  confirm: (code: string) => Promise<string[] | undefined>;
  /** Static copy for a failed confirm other than a wrong code. */
  messageFor: (err: unknown) => string;
  /** Codes saved (issued = true), or none were issued (a new phone). */
  onDone: (issued: boolean) => void;
  /** The leave guard (PR 1364): true while recovery codes are on screen unsaved. */
  onGuardChange: (guard: boolean) => void;
}

type Step = "add-key" | "enter-code" | "save-codes";

/**
 * Add the key to an authenticator app → enter a code → save the recovery
 * codes. Shared by TwoStepSetupScreen (signed in) and PasswordUpgradeScreen
 * (a short password's pass), which pass their own API call as `confirm` and
 * own the navigation guard. The guard is reported from the event handlers
 * that change the step, never an effect: an effect lags a render, and the
 * host's usePreventRemove must never see "unguarded" with codes on screen.
 */
export function TotpEnrollmentSteps({
  start,
  confirm,
  messageFor,
  onDone,
  onGuardChange,
}: TotpEnrollmentStepsProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [step, setStep] = useState<Step>(
    start.kind === "codes" ? "save-codes" : "add-key",
  );
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>(
    start.kind === "codes" ? start.codes : [],
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const secret = start.kind === "secret" ? start.secret : null;

  const openAuthenticator = async () => {
    if (!secret) return;
    setError("");
    try {
      await Linking.openURL(secret.otpauthUrl);
    } catch {
      setError("No authenticator app opened — copy the key instead.");
    }
  };

  const copy = async (text: string, what: string) => {
    await Clipboard.setStringAsync(text);
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(`${what} copied`);
  };

  // No try/finally, and no ternary/&&/?. inside the try: React Compiler
  // can't lower them.
  const onConfirmCode = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const issued = await confirm(code);
      setBusy(false);
      if (issued) {
        setCodes(issued);
        setStep("save-codes");
        onGuardChange(true);
        return;
      }
      onDone(false);
    } catch (err) {
      setBusy(false);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      if (err instanceof ApiError && err.code === "INVALID_SECOND_FACTOR") {
        setError(
          "That code didn't work. Check the time on your phone and try again.",
        );
        return;
      }
      setError(messageFor(err));
    }
  };

  const toggleSaved = () => {
    haptics.selection();
    const next = !saved;
    setSaved(next);
    onGuardChange(shouldGuardLeave("save-codes", next));
  };

  return (
    <>
      {step === "add-key" && secret ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Add OCRecipes to an authenticator app such as Google Authenticator,
            Microsoft Authenticator or 1Password.
          </ThemedText>
          <Button onPress={() => void openAuthenticator()}>
            Add to authenticator app
          </Button>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Or enter this key in the app:
          </ThemedText>
          <View
            style={[
              styles.keyBox,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundSecondary,
              },
            ]}
          >
            <ThemedText type="h4" selectable style={styles.key}>
              {formatSetupKey(secret.secret)}
            </ThemedText>
          </View>
          <Button
            variant="outline"
            onPress={() => void copy(secret.secret, "Key")}
          >
            Copy key
          </Button>
          <InlineError message={error} />
          <Button
            onPress={() => {
              setError("");
              setStep("enter-code");
            }}
          >
            Next
          </Button>
        </View>
      ) : null}

      {step === "enter-code" ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Enter the 6-digit code the app shows for OCRecipes.
          </ThemedText>
          <TextInput
            leftIcon="shield"
            placeholder="6-digit code"
            value={code}
            onChangeText={(v) => setCode(normalizeCodeInput(v))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={8}
            autoFocus
            editable={!busy}
            accessibilityLabel="6-digit code"
          />
          <InlineError message={error} />
          <Button
            onPress={() => void onConfirmCode()}
            disabled={code.length !== 6}
            loading={busy}
          >
            Confirm
          </Button>
        </View>
      ) : null}

      {step === "save-codes" ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Save these recovery codes somewhere other than this phone. Each
            works once if you lose the phone. They won&apos;t be shown again.
          </ThemedText>
          <View
            style={[
              styles.keyBox,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundSecondary,
              },
            ]}
          >
            {codes.map((c) => (
              <ThemedText key={c} type="body" selectable style={styles.code}>
                {c}
              </ThemedText>
            ))}
          </View>
          <View style={styles.row}>
            <Button
              variant="outline"
              style={styles.flex}
              onPress={() =>
                void copy(recoveryCodesText(codes), "Recovery codes")
              }
            >
              Copy all
            </Button>
            <Button
              variant="outline"
              style={styles.flex}
              onPress={() =>
                void Share.share({ message: recoveryCodesText(codes) })
              }
            >
              Share
            </Button>
          </View>
          <Pressable
            onPress={toggleSaved}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: saved }}
            accessibilityLabel="I've saved these"
            style={styles.checkRow}
          >
            <Feather
              name={saved ? "check-square" : "square"}
              size={22}
              color={saved ? theme.link : theme.textSecondary}
              accessible={false}
            />
            <ThemedText type="body">I&apos;ve saved these</ThemedText>
          </Pressable>
          <Button
            onPress={() => onDone(true)}
            disabled={!canFinishSaveCodes(saved)}
          >
            Done
          </Button>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.md },
  keyBox: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  key: { letterSpacing: 1, textAlign: "center" },
  code: { fontVariant: ["tabular-nums"], textAlign: "center" },
  row: { flexDirection: "row", gap: Spacing.md },
  flex: { flex: 1 },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 44,
  },
});
