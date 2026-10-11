import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { PasswordConfirmModal } from "@/components/PasswordConfirmModal";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { useTheme } from "@/hooks/useTheme";
import { useSignInMethods } from "@/hooks/useSignInMethods";
import { useSocialConfig } from "@/hooks/useSocialConfig";
import { useAuthContext } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { NATIVE_PROVIDERS } from "@/lib/social-sign-in";
import { Spacing } from "@/constants/theme";
import type { SecondFactorInput, SocialProvider } from "@shared/types/auth";
import {
  isSecondFactorRequired,
  isTwoStepCheckError,
  replacementFromError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import {
  identityErrorMessage,
  methodSubtitle,
  providerRowState,
} from "./SignInMethodsScreen-utils";

const PROVIDERS: { provider: SocialProvider; label: string }[] = [
  { provider: "apple", label: "Apple" },
  { provider: "google", label: "Google" },
];

const platform =
  Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";

/**
 * Settings → Sign-in methods: the account's password and Google/Apple
 * sign-ins. Connecting needs the password (owner ruling); a password is set
 * up through "Forgot password?", which only exists signed out.
 */
export default function SignInMethodsScreen() {
  const { theme } = useTheme();
  const toast = useToast();
  const { connectProvider, disconnectProvider, forgetTrustedPhones } =
    useAuthContext();
  const { methods, mfaEnabled, isError, refetch, setMethods } =
    useSignInMethods();
  const config = useSocialConfig();
  // Offer a connect only when this build can open the provider AND the
  // server can verify it (no Apple key on the server → no Apple connect).
  const connectable = {
    apple: NATIVE_PROVIDERS.apple && config.apple,
    google: NATIVE_PROVIDERS.google && config.google,
  };
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { confirm, ConfirmationModal, behindContentA11yProps, isOpen } =
    useConfirmationModal();
  const [connecting, setConnecting] = useState<SocialProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  // Two-step: ask for the code with the password (known on, or the server asked).
  const [needsCode, setNeedsCode] = useState(false);
  // A spent recovery code's replacement; `connected` = the connect itself worked.
  const [replacement, setReplacement] = useState<{
    code: string;
    connected: boolean;
  } | null>(null);

  // Same as SettingsScreen: hide the header back button while the sheet is
  // up so a screen reader can't swipe past the sheet to it.
  useEffect(() => {
    navigation.setOptions({ headerBackVisible: !isOpen });
  }, [isOpen, navigation]);

  if (!methods && isError) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.backgroundRoot }]}>
        <ThemedText style={[styles.errorText, { color: theme.textSecondary }]}>
          Couldn&apos;t load your sign-in methods.
        </ThemedText>
        <Button variant="outline" onPress={refetch}>
          Try again
        </Button>
      </View>
    );
  }

  if (!methods) {
    return (
      <View
        style={[styles.loading, { backgroundColor: theme.backgroundRoot }]}
        accessible
        accessibilityLabel="Loading sign-in methods"
      >
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  const label = (p: SocialProvider) =>
    PROVIDERS.find((x) => x.provider === p)?.label ?? p;

  const openConnect = (provider: SocialProvider) => {
    setConnectError(null);
    setNeedsCode(mfaEnabled);
    setReplacement(null);
    setConnecting(provider);
  };

  // No try/finally: React Compiler cannot lower a `finally`.
  const finishConnect = (provider: SocialProvider) => {
    setConnecting(null);
    setReplacement(null);
    toast.success(`${label(provider)} connected`);
  };

  const submitConnect = async (
    password: string,
    secondFactor?: SecondFactorInput,
  ) => {
    if (!connecting || busy) return;
    setBusy(true);
    setConnectError(null);
    const provider = connecting;
    try {
      let next;
      if (secondFactor) {
        next = await connectProvider(provider, password, secondFactor);
      } else {
        next = await connectProvider(provider, password);
      }
      setBusy(false);
      // null = the Apple sheet was cancelled: keep the prompt open to retry.
      if (next) {
        setMethods(next.signInMethods);
        if (next.replacementRecoveryCode) {
          // Show the new recovery code before closing.
          setReplacement({
            code: next.replacementRecoveryCode,
            connected: true,
          });
          return;
        }
        finishConnect(provider);
      }
    } catch (err) {
      setBusy(false);
      const spent = replacementFromError(err);
      if (spent) setReplacement({ code: spent, connected: false });
      if (isSecondFactorRequired(err)) {
        setNeedsCode(true);
        setConnectError("Enter the code from your authenticator app.");
        return;
      }
      setConnectError(
        isTwoStepCheckError(err)
          ? secondFactorErrorMessage(err).message
          : identityErrorMessage(err),
      );
    }
  };

  const disconnect = async (provider: SocialProvider) => {
    try {
      setMethods(await disconnectProvider(provider));
      toast.success(`${label(provider)} disconnected`);
    } catch (err) {
      toast.error(identityErrorMessage(err));
    }
  };

  const askDisconnect = (provider: SocialProvider) => {
    const name = label(provider);
    confirm({
      title: `Disconnect ${name}?`,
      message: `You won't be able to sign in with ${name} anymore.`,
      confirmLabel: "Disconnect",
      destructive: true,
      onConfirm: () => {
        void disconnect(provider);
      },
    });
  };

  const askForgetPhones = () => {
    confirm({
      title: "Forget trusted phones?",
      message:
        "Every phone, this one included, will ask for a code the next time you sign in with your password.",
      confirmLabel: "Forget",
      onConfirm: () => {
        void forgetPhones();
      },
    });
  };

  const forgetPhones = async () => {
    try {
      await forgetTrustedPhones();
      toast.success("Trusted phones forgotten");
    } catch {
      toast.error("Couldn't forget trusted phones. Please try again.");
    }
  };

  return (
    <>
      <ScreenScrollView
        style={{ backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={styles.content}
      >
        <Card elevation={1} style={styles.card} {...behindContentA11yProps}>
          <View style={styles.row}>
            <Feather
              name="lock"
              size={20}
              color={theme.textSecondary}
              accessible={false}
            />
            <View style={styles.rowText}>
              <ThemedText>Password</ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {methods.password ? "Set" : "Not set"}
              </ThemedText>
            </View>
            <Button
              variant="outline"
              onPress={() =>
                navigation.navigate("ChangePassword", {
                  hasPassword: methods.password,
                  providers: PROVIDERS.map((p) => p.provider).filter(
                    (p) => methods[p] !== null,
                  ),
                })
              }
              accessibilityLabel={
                methods.password ? "Change password" : "Set up a password"
              }
            >
              {methods.password ? "Change" : "Set up"}
            </Button>
          </View>

          {PROVIDERS.map(({ provider, label: name }) => {
            const state = providerRowState(
              methods,
              provider,
              platform,
              connectable,
            );
            if (state.kind === "hidden") return null;
            const hint =
              state.kind === "connect_blocked" ||
              (state.kind === "disconnect" && !state.enabled)
                ? state.hint
                : null;
            return (
              <View key={provider}>
                <View
                  style={[styles.divider, { backgroundColor: theme.border }]}
                />
                <View style={styles.row}>
                  <Feather
                    name="user-check"
                    size={20}
                    color={theme.textSecondary}
                    accessible={false}
                  />
                  <View style={styles.rowText}>
                    <ThemedText>{name}</ThemedText>
                    <ThemedText
                      type="small"
                      style={{ color: theme.textSecondary }}
                    >
                      {methodSubtitle(methods[provider])}
                    </ThemedText>
                  </View>
                  {state.kind === "connect" ? (
                    <Button
                      variant="outline"
                      onPress={() => openConnect(provider)}
                      accessibilityLabel={`Connect ${name}`}
                    >
                      Connect
                    </Button>
                  ) : state.kind === "disconnect" ? (
                    <Button
                      variant="outline"
                      onPress={() => askDisconnect(provider)}
                      disabled={!state.enabled}
                      accessibilityLabel={`Disconnect ${name}`}
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </View>
                {hint ? (
                  <ThemedText
                    type="small"
                    style={[styles.hint, { color: theme.textSecondary }]}
                  >
                    {hint}
                  </ThemedText>
                ) : null}
              </View>
            );
          })}
        </Card>

        <ThemedText
          type="small"
          accessibilityRole="header"
          style={[styles.sectionHeader, { color: theme.textSecondary }]}
        >
          SECURITY
        </ThemedText>
        <Card elevation={1} style={styles.card}>
          <View style={styles.row}>
            <Feather
              name="shield"
              size={20}
              color={theme.textSecondary}
              accessible={false}
            />
            <View style={styles.rowText}>
              <ThemedText>Two-step verification</ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {mfaEnabled
                  ? "On"
                  : methods.password
                    ? "Off"
                    : "Set a password to turn on two-step verification"}
              </ThemedText>
            </View>
            {!mfaEnabled && methods.password ? (
              <Button
                variant="outline"
                onPress={() =>
                  navigation.navigate("TwoStepSetup", { mode: "setup" })
                }
                accessibilityLabel="Turn on two-step verification"
              >
                Turn on
              </Button>
            ) : null}
          </View>
          {mfaEnabled
            ? (
                [
                  ["Set up on a new phone", "smartphone", "new_phone"],
                  ["New recovery codes", "key", "new_codes"],
                  ["Turn off two-step verification", "shield-off", "disable"],
                ] as const
              ).map(([text, icon, mode]) => (
                <View key={mode}>
                  <View
                    style={[styles.divider, { backgroundColor: theme.border }]}
                  />
                  <Pressable
                    onPress={() =>
                      navigation.navigate("TwoStepSetup", { mode })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={text}
                    style={styles.row}
                  >
                    <Feather
                      name={icon}
                      size={20}
                      color={theme.textSecondary}
                      accessible={false}
                    />
                    <ThemedText style={styles.rowText}>{text}</ThemedText>
                    <Feather
                      name="chevron-right"
                      size={20}
                      color={theme.textSecondary}
                      accessible={false}
                    />
                  </Pressable>
                </View>
              ))
            : null}
          {mfaEnabled ? (
            <View>
              <View
                style={[styles.divider, { backgroundColor: theme.border }]}
              />
              <Pressable
                onPress={askForgetPhones}
                accessibilityRole="button"
                accessibilityLabel="Forget trusted phones"
                accessibilityHint="Every phone will ask for a code at the next password sign-in"
                style={styles.row}
              >
                <Feather
                  name="x-circle"
                  size={20}
                  color={theme.textSecondary}
                  accessible={false}
                />
                <ThemedText style={styles.rowText}>
                  Forget trusted phones
                </ThemedText>
              </Pressable>
            </View>
          ) : null}
        </Card>
      </ScreenScrollView>

      <PasswordConfirmModal
        visible={connecting !== null}
        title={`Connect ${connecting ? label(connecting) : ""}`}
        message="Enter your password to confirm it's you."
        busy={busy}
        error={connectError}
        onCancel={() => setConnecting(null)}
        onSubmit={(pw, factor) => void submitConnect(pw, factor)}
        askCode={needsCode}
        replacementCode={replacement?.code ?? null}
        onReplacementSaved={() => {
          if (replacement?.connected && connecting) finishConnect(connecting);
          else setReplacement(null);
        }}
      />
      <ConfirmationModal />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  errorText: { textAlign: "center" },
  content: { paddingBottom: Spacing.xl },
  card: { marginHorizontal: Spacing.lg, marginTop: Spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowText: { flex: 1 },
  hint: { paddingBottom: Spacing.md },
  divider: { height: 1 },
  sectionHeader: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    letterSpacing: 0.5,
  },
});
