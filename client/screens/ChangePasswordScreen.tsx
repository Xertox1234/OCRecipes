import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { SecondFactorField } from "@/components/SecondFactorField";
import { ReplacementCodeCard } from "@/components/ReplacementCodeCard";
import { ApiError } from "@/lib/api-error";
import { useAuthContext } from "@/context/AuthContext";
import { useSignedInEmailCode } from "@/hooks/useSignInMethods";
import { useTheme } from "@/hooks/useTheme";
import type { ChangePasswordProof } from "@/hooks/useAuth";
import {
  isSecondFactorRequired,
  isTwoStepCheckError,
  normalizeCodeInput,
  replacementFromError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import {
  changePasswordErrorMessage,
  codeRequestErrorMessage,
  forgotOptions,
} from "./ChangePasswordScreen-utils";
import { passwordMessage } from "@shared/constants/password-policy";
import type { SecondFactorInput, SocialProvider } from "@shared/types/auth";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { Spacing } from "@/constants/theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "ChangePassword">;
type Mode = "current" | "forgot" | "code";
type SaveResult = {
  done: boolean;
  replacementRecoveryCode?: string;
  endSession?: () => Promise<void>;
};
type ErrorField = "current" | "code" | "new";

const ENTER_AUTH_CODE = "Enter the code from your authenticator app.";

/** Which input an error belongs to, so that field is marked invalid. */
function fieldFor(err: unknown): ErrorField | null {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === "UNAUTHORIZED") return "current";
  if (code === "INVALID_RESET_CODE") return "code";
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_BREACHED")
    return "new";
  return null;
}

/**
 * Change (or set) the password while signed in — change-password spec §3.
 * Proof: the current password, a fresh Google/Apple confirmation, or a code
 * emailed to the account; two-step accounts add the authenticator code for
 * the first and last. A stranger who knows only the email can't block it.
 */
export default function ChangePasswordScreen({ route, navigation }: Props) {
  const { hasPassword, providers, mfaEnabled } = route.params;
  const { theme } = useTheme();
  const { changePassword, requestPasswordChangeCode } = useAuthContext();
  // Set when the account's two-step codes come by email.
  const twoStepEmail = useSignedInEmailCode();
  const [mode, setMode] = useState<Mode>(hasPassword ? "current" : "forgot");
  const [current, setCurrent] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  // Two-step on: ask for the code with the first submit (the server would
  // otherwise refuse it — and an emailed-code guess would be spent finding out).
  const [needsFactor, setNeedsFactor] = useState(mfaEnabled);
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ErrorField | null>(null);
  const [busy, setBusy] = useState(false);
  // A ref, not state: a second tap in the same frame must see it.
  const busyRef = useRef(false);
  // A spent recovery code's replacement. `changed` = the request is over
  // (then "I've saved it" leaves — or, when this phone was signed out
  // mid-request, `endSession` signs out); after a refusal the card sits
  // above the form with its error, and the person tries again.
  const [replacement, setReplacement] = useState<{
    code: string;
    changed: boolean;
    endSession?: () => Promise<void>;
  } | null>(null);

  // The authenticator field remounts empty when the mode changes, so drop
  // the code it held then — never send a code the person can't see.
  // On an email two-step account the change code from the email IS the
  // second factor — never ask for a second emailed code (owner ruling 4).
  const factorNeeded = needsFactor && !(twoStepEmail && mode === "code");

  const switchMode = (next: Mode) => {
    if (next !== mode) setFactor(null);
    setMode(next);
  };

  const proofFor = (provider?: SocialProvider): ChangePasswordProof => {
    if (provider) return { provider };
    if (mode === "code") return { emailCode };
    return { password: current };
  };

  // Outside the try (React Compiler: no conditionals inside a try).
  const handleSaveError = (err: unknown) => {
    const spent = replacementFromError(err);
    if (spent) setReplacement({ code: spent, changed: false });
    if (isSecondFactorRequired(err)) {
      setNeedsFactor(true);
      setErrorField(null);
      setError(ENTER_AUTH_CODE);
      return;
    }
    setErrorField(fieldFor(err));
    setError(
      isTwoStepCheckError(err)
        ? secondFactorErrorMessage(err).message
        : changePasswordErrorMessage(err),
    );
  };
  const finishSave = (out: SaveResult) => {
    if (!out.done) return; // the Google/Apple sheet was cancelled
    if (out.replacementRecoveryCode)
      setReplacement({
        code: out.replacementRecoveryCode,
        changed: true,
        endSession: out.endSession,
      });
    else navigation.goBack();
  };

  const save = async (provider?: SocialProvider) => {
    if (busyRef.current) return;
    // Never send without the authenticator code once it's asked for: the
    // server would refuse, and an emailed-code guess would be spent on it.
    if (!provider && factorNeeded && !factor) {
      setErrorField(null);
      setError(ENTER_AUTH_CODE);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setErrorField(null);
    const proof = proofFor(provider);
    const secondFactor = factorNeeded && factor ? factor : undefined;
    let out: SaveResult | null = null;
    let failure: unknown = null;
    try {
      out = await changePassword(proof, newPassword, secondFactor);
    } catch (err) {
      failure = err;
    }
    busyRef.current = false;
    setBusy(false);
    if (failure !== null) handleSaveError(failure);
    else if (out) finishSave(out);
  };

  const sendCode = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setErrorField(null);
    let failure: unknown = null;
    try {
      await requestPasswordChangeCode();
    } catch (err) {
      failure = err;
    }
    busyRef.current = false;
    setBusy(false);
    if (failure !== null) setError(codeRequestErrorMessage(failure));
    else switchMode("code");
  };

  if (replacement && replacement.changed) {
    const { endSession } = replacement;
    return (
      <ScreenScrollView
        style={{ backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={styles.content}
        headerInsetExtra={Spacing.lg}
      >
        <ReplacementCodeCard
          code={replacement.code}
          onDone={() => (endSession ? void endSession() : navigation.goBack())}
        />
      </ScreenScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScreenScrollView
        contentContainerStyle={styles.content}
        headerInsetExtra={Spacing.lg}
      >
        {replacement ? (
          <ReplacementCodeCard
            code={replacement.code}
            onDone={() => setReplacement(null)}
          />
        ) : null}
        {mode === "current" ? (
          <View style={styles.group}>
            <TextInput
              accessibilityLabel="Current password"
              placeholder="Current password"
              value={current}
              onChangeText={setCurrent}
              error={errorField === "current"}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I forgot it"
              onPress={() => switchMode("forgot")}
              style={styles.link}
            >
              <ThemedText type="small" style={{ color: theme.link }}>
                I forgot it
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {mode === "code" ? (
          <View style={styles.group}>
            <TextInput
              accessibilityLabel="Code from the email"
              placeholder="6-digit code"
              value={emailCode}
              onChangeText={(t) => setEmailCode(normalizeCodeInput(t))}
              error={errorField === "code"}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send a new code"
              onPress={() => void sendCode()}
              style={styles.link}
            >
              <ThemedText type="small" style={{ color: theme.link }}>
                Send a new code
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="New password"
          placeholder="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          error={errorField === "new"}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
        />
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {passwordMessage("too_short")}
        </ThemedText>

        {factorNeeded && mode !== "forgot" ? (
          <SecondFactorField
            onChange={setFactor}
            busy={busy}
            autoFocus={false}
            emailCode={twoStepEmail}
          />
        ) : null}
        {error ? <InlineError message={error} /> : null}

        {mode === "forgot" ? (
          <View style={styles.group}>
            {forgotOptions(providers).map((option) => (
              <Button
                key={option.kind === "provider" ? option.provider : "email"}
                variant="outline"
                disabled={busy}
                accessibilityLabel={option.label}
                onPress={() =>
                  option.kind === "provider"
                    ? void save(option.provider)
                    : void sendCode()
                }
              >
                {option.label}
              </Button>
            ))}
          </View>
        ) : (
          <Button
            disabled={busy}
            accessibilityLabel="Save new password"
            onPress={() => void save()}
          >
            Save new password
          </Button>
        )}
      </ScreenScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  group: { gap: Spacing.sm },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
