import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Image,
  Dimensions,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { SocialSignInButtons } from "@/components/SocialSignInButtons";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { Spacing, withOpacity } from "@/constants/theme";
import {
  validateAuthForm,
  validateAuthFormFields,
  getAuthErrorMessage,
} from "./LoginScreen-utils";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useToast } from "@/context/ToastContext";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ApiError } from "@/lib/api-error";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const TERMS_URL = "https://ocrecipes.com/terms";
const PRIVACY_URL = "https://ocrecipes.com/privacy";

const HERO_HEIGHT = Dimensions.get("window").height * 0.25;

type Mode = "login" | "register";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { login, register } = useAuthContext();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Login">>();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>("login");
  // Prefilled with the email after a password reset (ResetPasswordScreen).
  const [username, setUsername] = useState(route.params?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  // Field-attributed error for the email input only (sets its aria-invalid).
  // Set on submit, mirroring `error`'s lifecycle — never validated live as the
  // user types. Stays null in login mode (no email field shown).
  const [emailError, setEmailError] = useState<string | null>(null);
  // COPPA 13+ age attestation — gated by checkbox; server enforces ageConfirmed:true
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  const passwordReset = route.params?.passwordReset === true;
  useEffect(() => {
    if (!passwordReset) return;
    toast.success("Password updated. Sign in with your new password.");
    // Consume the flag so a re-render or return visit doesn't re-toast.
    navigation.setParams({ passwordReset: undefined });
  }, [passwordReset, toast, navigation]);

  const openForgotPassword = () => {
    // Forward the identifier only when it is email-shaped — a username is
    // useless to the reset screen, which asks for the account email.
    navigation.navigate(
      "ForgotPassword",
      username.includes("@") ? { email: username.trim() } : undefined,
    );
  };

  const toggleAgeConfirmed = () => {
    haptics.selection();
    setAgeConfirmed((prev) => !prev);
  };

  const openExternalUrl = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setError("Unable to open that link. Please try again later.");
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    }
  };

  const openTerms = () => {
    void openExternalUrl(TERMS_URL);
  };

  const openPrivacy = () => {
    void openExternalUrl(PRIVACY_URL);
  };

  const handleSubmit = async () => {
    setError("");
    setEmailError(null);

    const formInput = {
      mode,
      username,
      password,
      confirmPassword,
      ageConfirmed,
      email,
    };
    // Attribute the email-specific failure to the email input (aria-invalid),
    // while the form-level banner still shows the first failing rule overall.
    setEmailError(validateAuthFormFields(formInput).email);

    const validationError = validateAuthForm(formInput);
    if (validationError) {
      setError(validationError);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setIsLoading(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password);
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      } else {
        const result = await register(
          username.trim(),
          password,
          email.trim(),
          ageConfirmed,
        );
        haptics.notification(Haptics.NotificationFeedbackType.Success);
        if (result.status === "verification_pending") {
          // Account created but email not verified → route to the verify screen
          // (the user is NOT authenticated yet; no token was issued). The server
          // sent a verification email on register, so signal that explicitly.
          navigation.navigate("VerifyEmail", {
            email: email.trim(),
            sent: true,
          });
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        // Valid credentials, unverified email → route to the verify screen.
        // The login path has no email to prefill.
        navigation.navigate("VerifyEmail", {});
        return;
      }
      setError(getAuthErrorMessage(err, mode));
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setEmailError(null);
    setConfirmPassword("");
    setAgeConfirmed(false);
  };

  const isSubmitDisabled = mode === "register" && !ageConfirmed;

  return (
    <ThemedView style={styles.container}>
      {/* Hero Image with Gradient Fade */}
      <View style={styles.heroContainer} accessibilityElementsHidden={true}>
        <Image
          source={require("../../assets/images/login-hero.jpg")}
          style={styles.heroImage}
          resizeMode="cover"
        />
        <LinearGradient
          colors={[
            "transparent",
            withOpacity(theme.backgroundRoot, 0.6),
            theme.backgroundRoot,
          ]}
          locations={[0, 0.5, 1]}
          style={styles.heroGradient}
        />
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Spacing.xl,
            paddingBottom: insets.bottom + Spacing["2xl"],
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText type="h2" style={styles.title}>
            Welcome!
          </ThemedText>
          <ThemedText
            testID="auth-form-subtitle"
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            {mode === "login"
              ? "Sign in to continue"
              : "Create an account to get started"}
          </ThemedText>
        </View>

        {/* Continue with Apple (Google later), in both modes. signed_in needs
            no action — the root navigator switches stacks on its own. */}
        <SocialSignInButtons
          onResult={(r) => {
            setError("");
            if (r.status === "choose_username") {
              navigation.navigate("ChooseUsername", {
                ticket: r.ticket,
                suggestedUsername: r.suggestedUsername,
              });
            } else if (r.status === "link_required") {
              navigation.navigate("ConnectAccount", {
                ticket: r.ticket,
                methods: r.methods,
                email: r.email,
              });
            }
          }}
          onError={setError}
        />

        <View style={styles.form}>
          {/* Sign-in accepts a username OR the account email; sign-up still
              needs a username (registerSchema rejects an email there). */}
          <TextInput
            leftIcon="user"
            placeholder={mode === "login" ? "Username or email" : "Username"}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            autoComplete="username"
            testID="input-username"
            accessibilityLabel={
              mode === "login" ? "Username or email" : "Username"
            }
            accessibilityHint={
              mode === "login"
                ? "Enter your username or email address"
                : "Enter your username"
            }
          />

          {mode === "register" ? (
            <TextInput
              leftIcon="mail"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
              testID="input-email"
              accessibilityLabel="Email"
              accessibilityHint="Enter your email address"
              error={!!emailError}
              errorMessage={emailError ?? undefined}
            />
          ) : null}

          <TextInput
            leftIcon="lock"
            rightIcon={showPassword ? "eye-off" : "eye"}
            rightIconAccessibilityLabel={
              showPassword ? "Hide password" : "Show password"
            }
            onRightIconPress={() => setShowPassword(!showPassword)}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            testID="input-password"
            accessibilityLabel="Password"
            accessibilityHint="Enter your password"
          />

          {mode === "login" ? (
            <Pressable
              onPress={openForgotPassword}
              accessibilityRole="button"
              accessibilityLabel="Forgot password?"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              testID="link-forgot-password"
              style={({ pressed }) => [
                styles.forgotLink,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <ThemedText type="small" style={{ color: theme.link }}>
                Forgot password?
              </ThemedText>
            </Pressable>
          ) : null}

          {mode === "register" ? (
            <TextInput
              leftIcon="lock"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              testID="input-confirm-password"
              accessibilityLabel="Confirm password"
              accessibilityHint="Re-enter your password to confirm"
            />
          ) : null}

          {mode === "register" ? (
            <View style={styles.ageGate}>
              <Pressable
                onPress={toggleAgeConfirmed}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ageConfirmed }}
                accessibilityLabel="I confirm I am 13 years of age or older"
                hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
                testID="checkbox-age-confirm"
                style={styles.ageCheckboxRow}
              >
                <Feather
                  name={ageConfirmed ? "check-square" : "square"}
                  size={22}
                  color={ageConfirmed ? theme.success : theme.textSecondary}
                />
                <ThemedText type="body" style={styles.ageCheckboxLabel}>
                  I confirm I am 13 years of age or older
                </ThemedText>
              </Pressable>
              <ThemedText
                type="caption"
                style={[styles.tosText, { color: theme.textSecondary }]}
              >
                By continuing, you agree to our{" "}
                <ThemedText
                  type="caption"
                  style={[styles.tosLink, { color: theme.link }]}
                  accessibilityRole="link"
                  accessibilityLabel="Terms of Service"
                  onPress={openTerms}
                >
                  Terms of Service
                </ThemedText>{" "}
                and{" "}
                <ThemedText
                  type="caption"
                  style={[styles.tosLink, { color: theme.link }]}
                  accessibilityRole="link"
                  accessibilityLabel="Privacy Policy"
                  onPress={openPrivacy}
                >
                  Privacy Policy
                </ThemedText>
                .
              </ThemedText>
            </View>
          ) : null}

          <InlineError message={error} />

          <Button
            onPress={handleSubmit}
            loading={isLoading}
            disabled={isSubmitDisabled}
            accessibilityLabel={
              isLoading
                ? mode === "login"
                  ? "Signing in"
                  : "Creating account"
                : mode === "login"
                  ? "Sign In"
                  : "Create Account"
            }
            style={styles.button}
          >
            {mode === "login" ? "Sign In" : "Create Account"}
          </Button>
        </View>

        <View style={styles.footer}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {mode === "login"
              ? "Don't have an account?"
              : "Already have an account?"}
          </ThemedText>
          <Pressable
            onPress={toggleMode}
            accessibilityLabel={
              mode === "login" ? "Switch to sign up" : "Switch to sign in"
            }
            accessibilityRole="button"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ThemedText
              type="body"
              style={[styles.linkText, { color: theme.link }]}
            >
              {mode === "login" ? "Sign Up" : "Sign In"}
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heroContainer: {
    height: HERO_HEIGHT,
    width: "100%",
    position: "relative",
  },
  heroImage: {
    width: "100%",
    height: "100%",
    opacity: 0.85,
  },
  heroGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT * 0.6,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing["2xl"],
    flexGrow: 1,
  },
  header: {
    alignItems: "flex-start",
    marginBottom: Spacing["3xl"],
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {},
  form: {
    gap: Spacing.lg,
    marginBottom: Spacing["3xl"],
  },
  button: {
    marginTop: Spacing.sm,
  },
  ageGate: {
    gap: Spacing.xs,
  },
  ageCheckboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  ageCheckboxLabel: {
    flexShrink: 1,
  },
  tosText: {
    lineHeight: 18,
  },
  tosLink: {
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: "auto",
  },
  linkText: {
    fontWeight: "600",
  },
  forgotLink: {
    alignSelf: "flex-end",
    minHeight: 44,
    justifyContent: "center",
  },
});
