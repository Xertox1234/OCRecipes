import React, { useState } from "react";
import { StyleSheet, View, Pressable, Image, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";

const HERO_HEIGHT = Dimensions.get("window").height * 0.25;

type Mode = "login" | "register";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { login, register } = useAuthContext();

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");

    if (!username.trim() || !password.trim()) {
      setError("Please fill in all fields");
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }

    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match");
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setIsLoading(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password);
      } else {
        await register(username.trim(), password);
      }
      haptics.notification(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Authentication failed";
      setError(message);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setConfirmPassword("");
  };

  return (
    <ThemedView style={styles.container}>
      {/* Hero Image with Gradient Fade */}
      <View style={styles.heroContainer}>
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
            type="body"
            style={[styles.subtitle, { color: theme.textSecondary }]}
          >
            {mode === "login"
              ? "Sign in to continue"
              : "Create an account to get started"}
          </ThemedText>
        </View>

        <View style={styles.form}>
          <TextInput
            leftIcon="user"
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            testID="input-username"
            accessibilityLabel="Username"
            accessibilityHint="Enter your username"
          />

          <TextInput
            leftIcon="lock"
            rightIcon={showPassword ? "eye-off" : "eye"}
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

          {error ? (
            <View
              style={[
                styles.errorContainer,
                { backgroundColor: withOpacity(theme.error, 0.06) },
              ]}
            >
              <Feather name="alert-circle" size={16} color={theme.error} />
              <ThemedText
                type="small"
                style={[styles.errorText, { color: theme.error }]}
              >
                {error}
              </ThemedText>
            </View>
          ) : null}

          <Button
            onPress={handleSubmit}
            loading={isLoading}
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
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.input,
  },
  errorText: {
    flex: 1,
  },
  button: {
    marginTop: Spacing.sm,
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
});
