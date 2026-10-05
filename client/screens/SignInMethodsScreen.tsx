import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

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
import type { SocialProvider } from "@shared/types/auth";
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
  const { user, connectProvider, disconnectProvider, logout } =
    useAuthContext();
  const { methods, setMethods } = useSignInMethods();
  const config = useSocialConfig();
  // Offer a connect only when this build can open the provider AND the
  // server can verify it (no Apple key on the server → no Apple connect).
  const connectable = {
    apple: NATIVE_PROVIDERS.apple && config.apple,
    google: NATIVE_PROVIDERS.google && config.google,
  };
  const navigation = useNavigation();
  const { confirm, ConfirmationModal, behindContentA11yProps, isOpen } =
    useConfirmationModal();
  const [connecting, setConnecting] = useState<SocialProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Same as SettingsScreen: hide the header back button while the sheet is
  // up so a screen reader can't swipe past the sheet to it.
  useEffect(() => {
    navigation.setOptions({ headerBackVisible: !isOpen });
  }, [isOpen, navigation]);

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
    setConnecting(provider);
  };

  // No try/finally: React Compiler cannot lower a `finally`.
  const submitConnect = async (password: string) => {
    if (!connecting || busy) return;
    setBusy(true);
    setConnectError(null);
    try {
      const next = await connectProvider(connecting, password);
      setBusy(false);
      const name = label(connecting);
      setConnecting(null);
      if (next) {
        setMethods(next);
        toast.success(`${name} connected`);
      }
    } catch (err) {
      setBusy(false);
      setConnectError(identityErrorMessage(err));
    }
  };

  const askDisconnect = (provider: SocialProvider) => {
    const name = label(provider);
    confirm({
      title: `Disconnect ${name}?`,
      message: `You won't be able to sign in with ${name} anymore.`,
      confirmLabel: "Disconnect",
      destructive: true,
      onConfirm: async () => {
        try {
          setMethods(await disconnectProvider(provider));
          toast.success(`${name} disconnected`);
        } catch (err) {
          toast.error(identityErrorMessage(err));
        }
      },
    });
  };

  const askPasswordReset = () => {
    const email = user?.email ? ` to ${user.email}` : "";
    confirm({
      title: methods.password ? "Change password" : "Set up a password",
      message: `You'll be signed out. On the sign-in screen, tap "Forgot password?" and we'll email a code${email}.`,
      confirmLabel: "Sign out",
      onConfirm: () => {
        void logout();
      },
    });
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
              onPress={askPasswordReset}
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
      </ScreenScrollView>

      <PasswordConfirmModal
        visible={connecting !== null}
        title={`Connect ${connecting ? label(connecting) : ""}`}
        message="Enter your password to confirm it's you."
        busy={busy}
        error={connectError}
        onCancel={() => setConnecting(null)}
        onSubmit={(pw) => void submitConnect(pw)}
      />
      <ConfirmationModal />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
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
});
