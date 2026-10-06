import React, { useState } from "react";
import {
  AccessibilityInfo,
  Linking,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useTheme } from "@/hooks/useTheme";
import { useSignInMethods } from "@/hooks/useSignInMethods";
import type { DeleteAccountProof } from "@/hooks/useAuth";
import { NATIVE_PROVIDERS } from "@/lib/social-sign-in";
import { Spacing, BorderRadius } from "@/constants/theme";
import { TOTP_CODE_LENGTH } from "@shared/constants/mfa";
import { deleteProofMode } from "./SignInMethodsScreen-utils";
import { normalizeCodeInput } from "./MfaChallengeScreen-utils";
import {
  formatSetupKey,
  getTwoFactorErrorMessage,
  recoveryCodesText,
} from "./TwoFactorSetupScreen-utils";

const platform =
  Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

type Step =
  | { kind: "start" }
  | { kind: "add-key"; secret: string; otpauthUrl: string }
  | { kind: "codes"; codes: string[] };

/**
 * Settings → Sign-in methods → Two-step verification. Off: confirm it's you,
 * add the key to an authenticator app, enter its first code, save the
 * recovery codes. On: turn it off or get new recovery codes (each needs the
 * password — or a fresh Apple/Google sign-in — AND a current code).
 */
export default function TwoFactorSetupScreen() {
  const { theme } = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const {
    startTwoFactorSetup,
    confirmTwoFactor,
    disableTwoFactor,
    replaceRecoveryCodes,
  } = useAuthContext();
  const { methods, twoFactor, refetch } = useSignInMethods();
  const proofMode = deleteProofMode(methods, platform, NATIVE_PROVIDERS);

  const [step, setStep] = useState<Step>({ kind: "start" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const enabled = twoFactor?.enabled === true;
  const providerName =
    proofMode.kind === "provider"
      ? proofMode.provider === "apple"
        ? "Apple"
        : "Google"
      : null;

  /** The proof for the server, or null after setting an inline error. */
  const proof = (): DeleteAccountProof | null => {
    if (proofMode.kind === "password") {
      if (!password) {
        setError("Enter your password.");
        return null;
      }
      return { password };
    }
    if (proofMode.kind === "provider") return { provider: proofMode.provider };
    setError("Set up a password first, then turn on two-step verification.");
    return null;
  };

  const needCode = (): boolean => {
    if (code.length === TOTP_CODE_LENGTH) return true;
    setError("Enter the 6-digit code from your authenticator app.");
    return false;
  };

  // No try/finally in these handlers: React Compiler cannot lower a `finally`.
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setBusy(false);
    } catch (err) {
      setBusy(false);
      setError(getTwoFactorErrorMessage(err));
    }
  };

  const onStart = () => {
    setError("");
    const p = proof();
    if (!p) return;
    void run(async () => {
      const setup = await startTwoFactorSetup(p);
      // Null = the provider sheet was cancelled; stay put.
      if (!setup) return;
      setPassword("");
      setStep({ kind: "add-key", ...setup });
      AccessibilityInfo.announceForAccessibility(
        "Add this key to your authenticator app, then enter its 6-digit code.",
      );
    });
  };

  const onOpenApp = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setError(
        "No authenticator app opened. Copy the key and add it in your app instead.",
      );
    }
  };

  const copy = async (text: string, announcement: string) => {
    await Clipboard.setStringAsync(text);
    AccessibilityInfo.announceForAccessibility(announcement);
  };

  const showCodes = (codes: string[]) => {
    setCode("");
    setPassword("");
    setStep({ kind: "codes", codes });
    AccessibilityInfo.announceForAccessibility(
      `Two-step verification recovery codes are on screen. Save them now; you won't see them again.`,
    );
  };

  const onConfirm = () => {
    setError("");
    if (!needCode()) return;
    void run(async () => showCodes(await confirmTwoFactor(code)));
  };

  const onTurnOff = () => {
    setError("");
    const p = proof();
    if (!p || !needCode()) return;
    void run(async () => {
      if (!(await disableTwoFactor(p, { code }))) return;
      refetch();
      toast.success("Two-step verification is off");
      navigation.goBack();
    });
  };

  const onNewCodes = () => {
    setError("");
    const p = proof();
    if (!p || !needCode()) return;
    void run(async () => {
      const codes = await replaceRecoveryCodes(p, code);
      if (codes) showCodes(codes);
    });
  };

  const done = () => {
    refetch();
    navigation.goBack();
  };

  const proofField =
    proofMode.kind === "password" ? (
      <TextInput
        leftIcon="lock"
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        textContentType="password"
        autoComplete="password"
        editable={!busy}
        accessibilityLabel="Password"
        accessibilityHint="Confirm it's you"
      />
    ) : providerName ? (
      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        {`You'll confirm it's you with ${providerName}.`}
      </ThemedText>
    ) : null;

  const codeField = (
    <TextInput
      leftIcon="shield"
      placeholder="6-digit code"
      value={code}
      onChangeText={(v) => setCode(normalizeCodeInput(v))}
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={TOTP_CODE_LENGTH + 2}
      editable={!busy}
      accessibilityLabel="6-digit code"
      accessibilityHint="The current code from your authenticator app"
    />
  );

  let body: React.ReactNode;
  if (step.kind === "codes") {
    body = (
      <>
        <ThemedText type="h3">Save your recovery codes</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          If you lose your phone, each code signs you in once. Keep them
          somewhere safe — you won&apos;t see them again.
        </ThemedText>
        <View
          style={[styles.codes, { backgroundColor: theme.backgroundSecondary }]}
        >
          {step.codes.map((c) => (
            <ThemedText key={c} selectable style={styles.code}>
              {c}
            </ThemedText>
          ))}
        </View>
        <Button
          variant="outline"
          onPress={() =>
            copy(recoveryCodesText(step.codes), "Recovery codes copied")
          }
        >
          Copy all
        </Button>
        <Button onPress={done}>I&apos;ve saved them</Button>
      </>
    );
  } else if (step.kind === "add-key") {
    body = (
      <>
        <ThemedText type="h3">
          Add OCRecipes to your authenticator app
        </ThemedText>
        <Button onPress={() => onOpenApp(step.otpauthUrl)}>
          Open in authenticator app
        </Button>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Or add this key in the app yourself:
        </ThemedText>
        <View
          style={[styles.codes, { backgroundColor: theme.backgroundSecondary }]}
        >
          <ThemedText
            selectable
            style={styles.code}
            accessibilityLabel={`Setup key: ${step.secret.split("").join(" ")}`}
          >
            {formatSetupKey(step.secret)}
          </ThemedText>
        </View>
        <Button
          variant="outline"
          onPress={() => copy(step.secret, "Setup key copied")}
        >
          Copy key
        </Button>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Then enter the 6-digit code the app shows:
        </ThemedText>
        {codeField}
        <InlineError message={error} />
        <Button onPress={onConfirm} loading={busy} loadingText="Turning on…">
          Turn on
        </Button>
      </>
    );
  } else if (enabled) {
    body = (
      <>
        <ThemedText type="h3">Two-step verification</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          {`On · ${twoFactor?.recoveryCodesRemaining ?? 0} recovery codes left`}
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          To change it, confirm it&apos;s you and enter a current code.
        </ThemedText>
        {proofField}
        {codeField}
        <InlineError message={error} />
        <Button variant="outline" onPress={onNewCodes} disabled={busy}>
          Get new recovery codes
        </Button>
        <Button variant="outline" onPress={onTurnOff} disabled={busy}>
          Turn off two-step verification
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <ThemedText type="h3">Two-step verification</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Signing in will also ask for a 6-digit code from an authenticator app
          on your phone (such as Google Authenticator, Microsoft Authenticator
          or 1Password).
        </ThemedText>
        {proofField}
        <InlineError message={error} />
        <Button onPress={onStart} loading={busy} loadingText="Starting…">
          Continue
        </Button>
      </>
    );
  }

  return (
    <ScreenScrollView
      style={{ backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={styles.content}
    >
      <Card elevation={1} style={styles.card}>
        <View style={styles.stack}>{body}</View>
      </Card>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing["2xl"] },
  card: { padding: Spacing.lg },
  stack: { gap: Spacing.md },
  codes: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    gap: Spacing.xs,
    alignItems: "center",
  },
  code: { fontVariant: ["tabular-nums"], letterSpacing: 1 },
});
