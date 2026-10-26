import React, { useRef, useState } from "react";
import * as Haptics from "expo-haptics";
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
import { FieldRules } from "@/components/FieldRules";
import { SecondFactorField } from "@/components/SecondFactorField";
import { ApiError } from "@/lib/api-error";
import { useAuthContext } from "@/context/AuthContext";
import { useSignedInEmailCode } from "@/hooks/useSignInMethods";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { focusFirstInvalid } from "@/lib/field-validation";
import { passwordRules, rulesVisible } from "@/lib/field-rules";
import type { ChangePasswordProof } from "@/hooks/useAuth";
import {
  ENTER_TWO_STEP_CODE,
  isSecondFactorRequired,
  isTwoStepCheckError,
  normalizeCodeInput,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import {
  changePasswordErrorMessage,
  codeRequestErrorMessage,
  forgotOptions,
} from "./ChangePasswordScreen-utils";
import type { SecondFactorInput, SocialProvider } from "@shared/types/auth";
import {
  newPasswordProblem,
  passwordMessage,
} from "@shared/constants/password-policy";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { Spacing } from "@/constants/theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "ChangePassword">;
type Mode = "current" | "forgot" | "code";
type SaveResult = { done: boolean };
type ErrorField = "current" | "code" | "new";

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
 * emailed to the account. On a two-step account the current password also
 * needs the emailed two-step code. A stranger who knows only the email can't
 * block it.
 */
export default function ChangePasswordScreen({ route, navigation }: Props) {
  const { hasPassword, providers, mfaEnabled } = route.params;
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { changePassword, requestPasswordChangeCode } = useAuthContext();
  const twoStepEmail = useSignedInEmailCode();
  const [mode, setMode] = useState<Mode>(hasPassword ? "current" : "forgot");
  // An empty field would go to the server and come back as a bare 400 that
  // reads "Something went wrong" — say which field instead. Flagged by Save
  // (empty fields wait for the button — form-fields spec §5.1); a flagged
  // field clears as soon as it is filled. The new password is also checked
  // against the password policy on leaving it with text, as on sign-up and
  // reset.
  const currentField = useFieldValidation((value) =>
    value ? null : "Enter your current password.",
  );
  const codeField = useFieldValidation((value) =>
    value ? null : "Enter the code from the email.",
  );
  const newField = useFieldValidation((value) => {
    if (!value) return "Enter a new password.";
    const problem = newPasswordProblem(value);
    return problem ? passwordMessage(problem) : null;
  });
  // Destructured, never read as `field.ref` in render: React Compiler treats an
  // object read through `.ref` as a ref and skips the whole component.
  const { ref: currentRef } = currentField;
  const { ref: codeRef } = codeField;
  const { ref: newRef } = newField;
  const current = currentField.value;
  const emailCode = codeField.value;
  const newPassword = newField.value;
  // The live checklist under the new password (spec §5.2). Once the field's
  // own error says what is wrong, the checklist hides its unmet line.
  const newChecklist = passwordRules(newPassword);
  // Two-step on: ask for the code with the first submit (the server would
  // otherwise refuse it — and an emailed-code guess would be spent finding out).
  const [needsFactor, setNeedsFactor] = useState(mfaEnabled);
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ErrorField | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped on each form-level validation reject (never a server error) to
  // shake that message; field rejects shake through each field's shakeKey.
  const [shakeKey, setShakeKey] = useState(0);
  // A ref, not state: a second tap in the same frame must see it.
  const busyRef = useRef(false);

  // The two-step field remounts empty when the mode changes, so drop the code
  // it held then — never send a code the person can't see. The change code
  // from the email already proves the inbox — never ask for a second emailed
  // code (owner ruling 4).
  const factorNeeded = needsFactor && mode !== "code";

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
    haptics.notification(Haptics.NotificationFeedbackType.Error);
    if (isSecondFactorRequired(err)) {
      setNeedsFactor(true);
      setErrorField(null);
      setError(ENTER_TWO_STEP_CODE);
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
    navigation.goBack();
  };

  const save = async (provider?: SocialProvider) => {
    if (busyRef.current) return;
    // A Google/Apple proof needs only the new password, so this also keeps
    // that sheet shut while it is empty.
    const fields = provider
      ? [newField]
      : mode === "code"
        ? [codeField, newField]
        : mode === "current"
          ? [currentField, newField]
          : [newField];
    if (!focusFirstInvalid(fields)) {
      // The field messages say what's missing (each shakes via its own
      // shakeKey); drop a stale server message.
      setErrorField(null);
      setError(null);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }
    // Never send without the two-step code once it's asked for: the server
    // would refuse, and a guess at the code would be spent on it.
    if (!provider && factorNeeded && !factor) {
      setErrorField(null);
      setError(ENTER_TWO_STEP_CODE);
      setShakeKey((k) => k + 1);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScreenScrollView
        contentContainerStyle={styles.content}
        headerInsetExtra={Spacing.lg}
      >
        {mode === "current" ? (
          <View style={styles.group}>
            <TextInput
              accessibilityLabel="Current password"
              label="Current password"
              ref={currentRef}
              value={current}
              onChangeText={currentField.onChangeText}
              onBlur={currentField.onBlur}
              editable={!busy}
              error={!!currentField.error || errorField === "current"}
              errorMessage={currentField.error ?? undefined}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
            />
            <InlineError
              message={currentField.error}
              shakeKey={currentField.shakeKey}
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
              label="Code from the email"
              placeholder="6-digit code"
              ref={codeRef}
              value={emailCode}
              onChangeText={(t) =>
                codeField.onChangeText(normalizeCodeInput(t))
              }
              onBlur={codeField.onBlur}
              editable={!busy}
              error={!!codeField.error || errorField === "code"}
              errorMessage={codeField.error ?? undefined}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            <InlineError
              message={codeField.error}
              shakeKey={codeField.shakeKey}
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

        {/* No form gap between a field and its checklist. */}
        <View>
          <TextInput
            accessibilityLabel="New password"
            label="New password"
            ref={newRef}
            value={newPassword}
            onChangeText={newField.onChangeText}
            onFocus={newField.onFocus}
            onBlur={newField.onBlur}
            editable={!busy}
            error={!!newField.error || errorField === "new"}
            errorMessage={newField.error ?? undefined}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
          />
          <FieldRules
            rules={newChecklist}
            visible={rulesVisible({
              focused: newField.focused,
              checked: newField.checked,
              rules: newChecklist,
            })}
            checked={newField.checked}
            // The server's too-short refusal lands as this field's error too.
            hideUnmet={newField.error !== null || errorField === "new"}
          />
        </View>
        <InlineError message={newField.error} shakeKey={newField.shakeKey} />

        {factorNeeded && mode !== "forgot" ? (
          <SecondFactorField
            onChange={setFactor}
            busy={busy}
            autoFocus={false}
            emailCode={twoStepEmail}
          />
        ) : null}
        {/* Always mounted: InlineError shakes on a shakeKey change, which a
            message view mounted by the same reject would never see. */}
        <InlineError message={error} shakeKey={shakeKey} />

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
