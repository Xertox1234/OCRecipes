import React, { useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { usePreventRemove } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SecondFactorInput } from "@shared/types/auth";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { SecondFactorField } from "@/components/SecondFactorField";
import { ReplacementCodeCard } from "@/components/ReplacementCodeCard";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { ApiError } from "@/lib/api-error";
import {
  isTwoStepCheckError,
  normalizeCodeInput,
  replacementFromError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import { BorderRadius, Spacing } from "@/constants/theme";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import {
  PASSWORD_MAX,
  PASSWORD_MIN_SINGLE_FACTOR,
  passwordMessage,
} from "@shared/constants/password-policy";
import {
  BREACHED_PASSWORD_MESSAGE,
  validateNewPassword,
} from "./LoginScreen-utils";
import {
  canFinishSaveCodes,
  formatSetupKey,
  recoveryCodesText,
  setupTitle,
  shouldGuardLeave,
  type TwoStepSetupStep,
} from "./TwoStepSetupScreen-utils";

type Props = NativeStackScreenProps<ProfileStackParamList, "TwoStepSetup">;

const ME_KEY = ["/api/auth/me"] as const;

const UPGRADE_NEEDED_MESSAGE =
  "Your password is shorter than 15 characters. Choose a new one of at least 15 to turn off two-step verification.";
// iOS strong-password suggestions honour these (spec §2).
const NEW_PASSWORD_RULES = `minlength: ${PASSWORD_MIN_SINGLE_FACTOR}; maxlength: ${PASSWORD_MAX};`;

/** Static copy for a failed request on this screen — never the raw response. */
function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "MFA_SETUP_DISABLED")
      return "Two-step verification isn't available yet.";
    if (err.code === "UNAUTHORIZED")
      return "Incorrect password. Please try again.";
    if (err.code === "MFA_NEEDS_PASSWORD")
      return "Set a password first — two-step verification protects password sign-in.";
    if (err.code === "MFA_ALREADY_ENABLED")
      return "Two-step verification is already on.";
    if (err.code === "MFA_NOT_ENABLED") return "Two-step verification is off.";
    if (err.code === "PASSWORD_UPGRADE_NEEDED") return UPGRADE_NEEDED_MESSAGE;
    if (err.code === "PASSWORD_TOO_SHORT")
      return passwordMessage("too_short", "single_factor");
    if (err.code === "PASSWORD_BREACHED") return BREACHED_PASSWORD_MESSAGE;
    if (isTwoStepCheckError(err)) return secondFactorErrorMessage(err).message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Two-step verification (authenticator app): turn it on, move it to a new
 * phone, turn it off, or make new recovery codes.
 */
export default function TwoStepSetupScreen({ route, navigation }: Props) {
  const { mode } = route.params;
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const queryClient = useQueryClient();
  const auth = useAuthContext();
  const needsFactor = mode !== "setup";

  const [step, setStep] = useState<TwoStepSetupStep>("confirm");
  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);
  const [secret, setSecret] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [replacement, setReplacement] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Turning it off with a password under 15: the server asks for a new 15+
  // one in the same step (PASSWORD_UPGRADE_NEEDED). It answers before the
  // factor check, so a recovery code typed above is still unspent.
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // Swipe-back, header back or Android back while the codes are unsaved.
  // Done is only enabled once they're ticked as saved, so its goBack() passes.
  usePreventRemove(shouldGuardLeave(step, saved), ({ data }) => {
    Alert.alert(
      "Leave without saving your codes?",
      "They won't be shown again. If you lose this phone without them, you'll have to contact support to get back in.",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });

  const fail = (err: unknown) => {
    setBusy(false);
    haptics.notification(Haptics.NotificationFeedbackType.Error);
    // A recovery code spent on a request that then failed: show its replacement.
    const spent = replacementFromError(err);
    if (spent) setReplacement(spent);
    if (err instanceof ApiError && err.code === "PASSWORD_UPGRADE_NEEDED") {
      setNeedsNewPassword(true);
    }
    setError(messageFor(err));
  };

  const finish = (message: string) => {
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(message);
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
    navigation.goBack();
  };

  // No try/finally in the handlers: React Compiler cannot lower a `finally`.
  const onConfirmIdentity = async () => {
    if (busy || !password || (needsFactor && !factor)) return;
    // Checked here, before the try (React Compiler can't lower a ternary in it).
    const newPasswordError = needsNewPassword
      ? validateNewPassword(newPassword, confirmNewPassword, {
          min: PASSWORD_MIN_SINGLE_FACTOR,
          context: "single_factor",
        })
      : null;
    if (newPasswordError) {
      setError(newPasswordError);
      return;
    }
    const upgrade = needsNewPassword ? newPassword : undefined;
    setBusy(true);
    setError("");
    try {
      if (mode === "setup") {
        setSecret(await auth.startTwoStepSetup(password));
        setStep("add-key");
      } else if (factor) {
        // No `&&`/ternaries in here: React Compiler can't lower them in a try.
        if (mode === "new_phone") {
          const next = await auth.startNewPhone(password, factor);
          setSecret({ secret: next.secret, otpauthUrl: next.otpauthUrl });
          if (next.replacementRecoveryCode) {
            setReplacement(next.replacementRecoveryCode);
          }
          setStep("add-key");
        } else if (mode === "disable") {
          await auth.disableTwoStep(password, factor, upgrade);
          finish("Two-step verification is off");
          return;
        } else {
          setCodes(await auth.replaceRecoveryCodes(password, factor));
          setStep("save-codes");
        }
      }
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  };

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

  const onConfirmCode = async () => {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const result = await auth.confirmTwoStep(code);
      setBusy(false);
      if (result.recoveryCodes) {
        setCodes(result.recoveryCodes);
        setStep("save-codes");
        return;
      }
      finish("Two-step verification moved to this phone");
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_SECOND_FACTOR") {
        setBusy(false);
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        setError(
          "That code didn't work. Check the time on your phone and try again.",
        );
        return;
      }
      fail(err);
    }
  };

  return (
    <ScreenScrollView contentContainerStyle={styles.content}>
      <ThemedText type="h3" accessibilityRole="header">
        {setupTitle(mode)}
      </ThemedText>

      {replacement ? (
        <ReplacementCodeCard
          code={replacement}
          onDone={() => setReplacement(null)}
        />
      ) : null}

      {step === "confirm" ? (
        <View style={styles.section}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {needsFactor
              ? "Enter your password and a code from your authenticator app (or a recovery code)."
              : "Enter your password to start."}
          </ThemedText>
          <TextInput
            leftIcon="lock"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!busy}
            accessibilityLabel="Password"
          />
          {needsFactor ? (
            <SecondFactorField
              onChange={setFactor}
              busy={busy}
              autoFocus={false}
            />
          ) : null}
          {needsNewPassword ? (
            <>
              <TextInput
                leftIcon="lock"
                placeholder="New password"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                passwordRules={NEW_PASSWORD_RULES}
                editable={!busy}
                accessibilityLabel="New password"
                accessibilityHint={`At least ${PASSWORD_MIN_SINGLE_FACTOR} characters`}
              />
              <TextInput
                leftIcon="lock"
                placeholder="Confirm new password"
                value={confirmNewPassword}
                onChangeText={setConfirmNewPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                passwordRules={NEW_PASSWORD_RULES}
                editable={!busy}
                accessibilityLabel="Confirm new password"
              />
            </>
          ) : null}
          <InlineError message={error} />
          <Button
            onPress={() => void onConfirmIdentity()}
            disabled={
              !password ||
              (needsFactor && !factor) ||
              (needsNewPassword && (!newPassword || !confirmNewPassword))
            }
            loading={busy}
            variant={mode === "disable" ? "secondary" : "primary"}
          >
            {mode === "disable" ? "Turn off" : "Continue"}
          </Button>
        </View>
      ) : null}

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
            onPress={() => {
              haptics.selection();
              setSaved((v) => !v);
            }}
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
            onPress={() =>
              finish(
                mode === "setup"
                  ? "Two-step verification is on"
                  : "New recovery codes saved",
              )
            }
            disabled={!canFinishSaveCodes(saved)}
          >
            Done
          </Button>
        </View>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.xl },
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
