import React, { useEffect, useState } from "react";
import { StyleSheet, View, Pressable, Image, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedText } from "@/components/ThemedText";
import { LegalConsentCaption } from "@/components/LegalConsentCaption";
import { InlineError } from "@/components/InlineError";
import { SocialSignInButtons } from "@/components/SocialSignInButtons";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { focusFirstInvalid } from "@/lib/field-validation";
import { useAuthContext } from "@/context/AuthContext";
import { twoStepCodeParams } from "@/lib/second-factor-utils";
import { Spacing, withOpacity } from "@/constants/theme";
import {
  validateAuthForm,
  validateAuthFormFields,
  validateUsername,
  getAuthErrorMessage,
  registerPasswordHint,
  registerPasswordRules,
  PASSWORD_MISMATCH_MESSAGE,
} from "./LoginScreen-utils";
import {
  newPasswordProblem,
  passwordMessage,
} from "@shared/constants/password-policy";
import {
  useIsFocused,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useToast } from "@/context/ToastContext";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ApiError } from "@/lib/api-error";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

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
  const isFocused = useIsFocused();

  const [mode, setMode] = useState<Mode>("login");
  // Each field shows its own message: on leaving it with text, live once
  // shown, and on the main button for empty fields (form-fields spec §5.1).
  // Sign-in only checks that fields are filled — the server is the authority
  // and a format check there would be a username-enumeration hint.
  // Prefilled with the email after a password reset (ResetPasswordScreen).
  const usernameField = useFieldValidation((value) => {
    if (value.trim() === "") {
      return mode === "login"
        ? "Enter your username or email."
        : "Enter a username.";
    }
    return mode === "login" ? null : validateUsername(value.trim());
  }, route.params?.email ?? "");
  const emailField = useFieldValidation(
    (value) =>
      validateAuthFormFields({
        mode,
        username: "",
        password: "",
        confirmPassword: "",
        ageConfirmed: false,
        email: value,
      }).email,
  );
  const passwordField = useFieldValidation((value) => {
    if (mode === "login") {
      return value.trim() === "" ? "Enter your password." : null;
    }
    if (value === "") return "Enter a password.";
    const problem = newPasswordProblem(value);
    return problem ? passwordMessage(problem) : null;
  });
  const confirmField = useFieldValidation((value) => {
    if (mode === "login" || value === passwordField.value) return null;
    return value === "" ? "Re-enter your password." : PASSWORD_MISMATCH_MESSAGE;
  });
  const username = usernameField.value;
  const password = passwordField.value;
  const confirmPassword = confirmField.value;
  const email = emailField.value;
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Server/flow errors (and the age confirmation); field messages sit under
  // each field.
  const [error, setError] = useState("");
  // Bumped on each validation reject (not server errors) to shake the error.
  const [shakeKey, setShakeKey] = useState(0);
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

  const showLinkError = () => {
    setError("Unable to open that link. Please try again later.");
    haptics.notification(Haptics.NotificationFeedbackType.Error);
  };

  const handleSubmit = async () => {
    setError("");

    const fields =
      mode === "register"
        ? [usernameField, emailField, passwordField, confirmField]
        : [usernameField, passwordField];
    if (!focusFirstInvalid(fields)) {
      // Each invalid field's message shakes via its own shakeKey.
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const formInput = {
      mode,
      username,
      password,
      confirmPassword,
      ageConfirmed,
      email,
    };
    // Second guard over the whole form (it also covers the age confirmation).
    const validationError = validateAuthForm(formInput);
    if (validationError) {
      setError(validationError);
      setShakeKey((k) => k + 1);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setIsLoading(true);
    try {
      if (mode === "login") {
        const result = await login(username.trim(), password);
        if (result.status === "mfa_required") {
          // Right password on a 2FA account (and this phone isn't trusted).
          navigation.navigate(
            "TwoStepCode",
            twoStepCodeParams(result, "login"),
          );
          return;
        }
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
      // A rejected password left in the field is what iOS offers to save when
      // the user leaves. Register keeps it: a taken username isn't a bad password.
      // reset, not setValue: the emptied field must not then show its own
      // "Enter your password." over the server's message.
      if (mode === "login") passwordField.reset("");
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    // The other mode has other rules: start its fields with no error showing.
    usernameField.reset(username);
    emailField.reset(email);
    passwordField.reset(password);
    confirmField.reset("");
    setAgeConfirmed(false);
  };

  const isSubmitDisabled = mode === "register" && !ageConfirmed;

  return (
    <ThemedView style={styles.container}>
      {/* Light content over the dark hero photo. Focus-gated: Login stays
          mounted under the other auth screens and the last-mounted StatusBar
          wins, so unmounting hands control back to App.tsx's global one. */}
      {isFocused && <StatusBar style="light" />}
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
          // Same as password login: no email to prefill.
          onUnverifiedEmail={() => navigation.navigate("VerifyEmail", {})}
        />

        <View style={styles.form}>
          {/* Sign-in accepts a username OR the account email; sign-up still
              needs a username (registerSchema rejects an email there). */}
          <TextInput
            leftIcon="user"
            label={mode === "login" ? "Username or email" : "Username"}
            ref={usernameField.ref}
            value={username}
            onChangeText={usernameField.onChangeText}
            onBlur={usernameField.onBlur}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            autoComplete="username"
            testID="input-username"
            accessibilityHint={
              mode === "login"
                ? "Enter your username or email address"
                : "Enter your username"
            }
            error={!!usernameField.error}
            errorMessage={usernameField.error ?? undefined}
          />
          <InlineError
            message={usernameField.error}
            shakeKey={usernameField.shakeKey}
          />

          {mode === "register" ? (
            <TextInput
              leftIcon="mail"
              label="Email"
              placeholder="you@example.com"
              ref={emailField.ref}
              value={email}
              onChangeText={emailField.onChangeText}
              onBlur={emailField.onBlur}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
              testID="input-email"
              accessibilityHint="Enter your email address"
              error={!!emailField.error}
              errorMessage={emailField.error ?? undefined}
            />
          ) : null}
          {mode === "register" ? (
            <InlineError
              message={emailField.error}
              shakeKey={emailField.shakeKey}
            />
          ) : null}

          <TextInput
            leftIcon="lock"
            rightIcon={showPassword ? "eye-off" : "eye"}
            rightIconAccessibilityLabel={
              showPassword ? "Hide password" : "Show password"
            }
            onRightIconPress={() => setShowPassword(!showPassword)}
            label="Password"
            ref={passwordField.ref}
            value={password}
            onChangeText={passwordField.onChangeText}
            onBlur={passwordField.onBlur}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType={mode === "register" ? "newPassword" : "password"}
            autoComplete={mode === "register" ? "new-password" : undefined}
            passwordRules={
              mode === "register" ? registerPasswordRules() : undefined
            }
            testID="input-password"
            accessibilityHint={
              mode === "register"
                ? registerPasswordHint()
                : "Enter your password"
            }
            error={!!passwordField.error}
            errorMessage={passwordField.error ?? undefined}
          />
          <InlineError
            message={passwordField.error}
            shakeKey={passwordField.shakeKey}
          />

          {mode === "register" ? (
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {registerPasswordHint()}
            </ThemedText>
          ) : null}

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
              label="Confirm password"
              ref={confirmField.ref}
              value={confirmPassword}
              onChangeText={confirmField.onChangeText}
              onBlur={confirmField.onBlur}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              textContentType="newPassword"
              autoComplete="new-password"
              passwordRules={registerPasswordRules()}
              testID="input-confirm-password"
              accessibilityHint="Re-enter your password to confirm"
              error={!!confirmField.error}
              errorMessage={confirmField.error ?? undefined}
            />
          ) : null}
          {mode === "register" ? (
            <InlineError
              message={confirmField.error}
              shakeKey={confirmField.shakeKey}
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
              <LegalConsentCaption onLinkError={showLinkError} />
            </View>
          ) : null}

          <InlineError message={error} shakeKey={shakeKey} />

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
