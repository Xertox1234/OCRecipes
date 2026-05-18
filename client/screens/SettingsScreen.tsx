import React, { ComponentProps, useCallback, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  ScrollView,
  Platform,
  Alert,
  Linking,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { UpgradeModal } from "@/components/UpgradeModal";
import { DeleteAccountModal } from "@/components/DeleteAccountModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { usePremiumContext } from "@/context/PremiumContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { useMeasurementUnit } from "@/hooks/useMeasurementUnit";
import { apiRequest } from "@/lib/query-client";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { PRIVACY_POLICY_URL, TERMS_URL } from "@/constants/legal";
import type { MeasurementUnit } from "@shared/lib/units";
import type { ProfileScreenNavigationProp } from "@/types/navigation";

const MEASUREMENT_UNIT_OPTIONS: { value: MeasurementUnit; label: string }[] = [
  { value: "metric", label: "Metric (kg)" },
  { value: "imperial", label: "Imperial (lbs)" },
];

type FeatherIconName = ComponentProps<typeof Feather>["name"];

interface SettingsItemConfig {
  id: string;
  icon: FeatherIconName;
  label: string;
  premiumKey?: "healthKitSync" | "glp1Companion" | "adaptiveGoals";
  danger?: boolean;
  iosOnly?: boolean;
}

const SETTINGS_ITEMS: SettingsItemConfig[] = [
  { id: "editProfile", icon: "edit-2", label: "Edit Profile" },
  { id: "tasteProfile", icon: "star", label: "Taste Profile" },
  {
    id: "healthkit",
    icon: "heart",
    label: "Apple Health",
    premiumKey: "healthKitSync",
    iosOnly: true,
  },
  {
    id: "glp1",
    icon: "activity",
    label: "GLP-1 Companion",
    premiumKey: "glp1Companion",
  },
  {
    id: "goals",
    icon: "target",
    label: "Nutrition Goals",
    premiumKey: "adaptiveGoals",
  },
  { id: "coachReminders", icon: "bell", label: "Coach Reminders" },
  { id: "subscription", icon: "credit-card", label: "Subscription" },
  { id: "exportData", icon: "download", label: "Export My Data" },
  { id: "signout", icon: "log-out", label: "Sign Out", danger: true },
  {
    id: "deleteAccount",
    icon: "trash-2",
    label: "Delete Account",
    danger: true,
  },
];

export default function SettingsScreen() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { logout, deleteAccount, user, updateUser } = useAuthContext();
  const { isPremium } = usePremiumContext();
  const measurementUnit = useMeasurementUnit();

  const healthKitUnlocked = usePremiumFeature("healthKitSync");
  const glp1Unlocked = usePremiumFeature("glp1Companion");
  const goalsUnlocked = usePremiumFeature("adaptiveGoals");

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleDeleteAccount = useCallback(
    async (password: string) => {
      // deleteAccount throws on failure (e.g. wrong password). Let the modal
      // surface the error and keep itself open — only close on success.
      await deleteAccount(password);
      setShowDeleteAccountModal(false);
      // No explicit navigation needed: the root navigator gate switches to
      // the auth stack when `isAuthenticated` flips to false.
    },
    [deleteAccount],
  );

  const performExport = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const res = await apiRequest("GET", "/api/users/me/export");
      const json = await res.text();
      await Share.share({
        title: "OCRecipes Data Export",
        message: json,
      });
    } catch (error) {
      const message =
        error instanceof Error && /^429:/.test(error.message)
          ? "You have already exported recently. Please wait before trying again."
          : "Could not export your data. Please try again.";
      Alert.alert("Export Failed", message);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting]);

  const handleExportData = useCallback(() => {
    // Warn the user before broadcasting their full personal-data payload through
    // the system share sheet — recipients of the share will see plaintext PII.
    Alert.alert(
      "Export My Data",
      "This will create a JSON copy of all data we hold for you (profile, scan history, meal plans, chats, weight logs, etc.) and open the share sheet. Anyone you share the file with will see this data in plain text. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Export",
          onPress: () => {
            void performExport();
          },
        },
      ],
    );
  }, [performExport]);

  const handleSelectMeasurementUnit = useCallback(
    (next: MeasurementUnit) => {
      if (next === measurementUnit) return;
      haptics.selection();
      // measurementUnit lives on the user record — persist via /api/auth/profile.
      updateUser({ measurementUnit: next }).catch(() => {
        Alert.alert(
          "Could not save",
          "Failed to update your measurement unit. Please try again.",
        );
      });
    },
    [measurementUnit, haptics, updateUser],
  );

  const isUnlocked = useCallback(
    (key?: string) => {
      if (!key) return true;
      if (key === "healthKitSync") return healthKitUnlocked;
      if (key === "glp1Companion") return glp1Unlocked;
      if (key === "adaptiveGoals") return goalsUnlocked;
      return true;
    },
    [healthKitUnlocked, glp1Unlocked, goalsUnlocked],
  );

  const handlePress = useCallback(
    (id: string) => {
      haptics.selection();
      switch (id) {
        case "editProfile":
          navigation.navigate("EditDietaryProfile");
          break;
        case "tasteProfile":
          navigation.navigate("TasteProfile");
          break;
        case "healthkit":
          if (healthKitUnlocked) {
            navigation.navigate("HealthKitSettings");
          } else {
            setShowUpgradeModal(true);
          }
          break;
        case "glp1":
          if (glp1Unlocked) {
            navigation.navigate("GLP1Companion");
          } else {
            setShowUpgradeModal(true);
          }
          break;
        case "goals":
          if (goalsUnlocked) {
            navigation.navigate("GoalSetup");
          } else {
            setShowUpgradeModal(true);
          }
          break;
        case "coachReminders":
          navigation.navigate("CoachReminders");
          break;
        case "subscription":
          if (isPremium) {
            if (Platform.OS === "ios") {
              Linking.openURL("https://apps.apple.com/account/subscriptions");
            } else {
              Linking.openURL(
                "https://play.google.com/store/account/subscriptions",
              );
            }
          } else {
            setShowUpgradeModal(true);
          }
          break;
        case "exportData":
          handleExportData();
          break;
        case "signout":
          Alert.alert("Sign Out", "Are you sure you want to sign out?", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Sign Out",
              style: "destructive",
              onPress: () => logout(),
            },
          ]);
          break;
        case "deleteAccount":
          setShowDeleteAccountModal(true);
          break;
      }
    },
    [
      haptics,
      navigation,
      healthKitUnlocked,
      glp1Unlocked,
      goalsUnlocked,
      isPremium,
      logout,
      handleExportData,
    ],
  );

  const visibleItems = SETTINGS_ITEMS.filter(
    (item) => !item.iosOnly || Platform.OS === "ios",
  );

  const openLegalUrl = useCallback(
    async (url: string, fallbackLabel: string) => {
      try {
        haptics.selection();
      } catch {
        // Haptics may fail in simulators or restricted environments — never
        // block opening a legal URL on a secondary effect.
      }
      // Call openURL directly. `canOpenURL` is unreliable for HTTP(S) on
      // iOS (false negatives without LSApplicationQueriesSchemes entries)
      // and would block users from reaching required legal documents.
      try {
        await Linking.openURL(url);
      } catch (error) {
        console.warn("Failed to open legal URL", { url, error });
        Alert.alert(
          "Unable to open link",
          `Please visit ${fallbackLabel} in your browser: ${url}`,
        );
      }
    },
    [haptics],
  );

  const appVersion = Constants.expoConfig?.version ?? "—";
  const buildNumber =
    Platform.OS === "ios"
      ? (Constants.expoConfig?.ios?.buildNumber ?? null)
      : Constants.expoConfig?.android?.versionCode != null
        ? String(Constants.expoConfig.android.versionCode)
        : null;
  const versionLabel = buildNumber
    ? `Version ${appVersion} (${buildNumber})`
    : `Version ${appVersion}`;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
    >
      <Card elevation={1} style={styles.card}>
        {visibleItems.map((item, index) => {
          const unlocked = isUnlocked(item.premiumKey);
          return (
            <React.Fragment key={item.id}>
              {index > 0 && (
                <View
                  style={[styles.divider, { backgroundColor: theme.border }]}
                />
              )}
              <Pressable
                onPress={() => handlePress(item.id)}
                accessibilityLabel={
                  !unlocked
                    ? `${item.label}. Premium feature, locked`
                    : item.label
                }
                accessibilityRole="button"
                accessibilityHint={
                  !unlocked ? "Opens upgrade screen" : "Tap to open"
                }
                style={({ pressed }) => [
                  styles.settingsItem,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={styles.settingsItemLeft}>
                  <Feather
                    name={item.icon}
                    size={20}
                    color={item.danger ? theme.error : theme.textSecondary}
                    accessible={false}
                  />
                  <ThemedText
                    style={[
                      styles.settingsLabel,
                      item.danger && { color: theme.error },
                    ]}
                  >
                    {item.label}
                  </ThemedText>
                </View>
                <View style={styles.settingsItemRight}>
                  {!unlocked && (
                    <Feather
                      name="lock"
                      size={14}
                      color={theme.textSecondary}
                      accessible={false}
                    />
                  )}
                  {!item.danger && (
                    <Feather
                      name="chevron-right"
                      size={18}
                      color={theme.textSecondary}
                      accessible={false}
                    />
                  )}
                </View>
              </Pressable>
            </React.Fragment>
          );
        })}
      </Card>

      <Card elevation={1} style={styles.card}>
        <View style={styles.unitSectionHeader}>
          <Feather
            name="sliders"
            size={20}
            color={theme.textSecondary}
            accessible={false}
          />
          <ThemedText style={styles.settingsLabel}>Units</ThemedText>
        </View>
        <View
          style={styles.unitOptionRow}
          accessibilityRole="radiogroup"
          accessibilityLabel="Measurement unit for body weight"
        >
          {MEASUREMENT_UNIT_OPTIONS.map((option) => {
            const selected = measurementUnit === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => handleSelectMeasurementUnit(option.value)}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                style={[
                  styles.unitOption,
                  {
                    backgroundColor: selected
                      ? withOpacity(theme.success, 0.12)
                      : theme.backgroundSecondary,
                    borderColor: selected ? theme.success : "transparent",
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.unitOptionLabel,
                    { color: selected ? theme.success : theme.text },
                  ]}
                >
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card elevation={1} style={styles.card}>
        <Pressable
          onPress={() => openLegalUrl(PRIVACY_POLICY_URL, "our Privacy Policy")}
          accessibilityLabel="Privacy Policy"
          accessibilityRole="link"
          accessibilityHint="Opens our Privacy Policy in your browser"
          style={({ pressed }) => [
            styles.settingsItem,
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={styles.settingsItemLeft}>
            <Feather
              name="shield"
              size={20}
              color={theme.textSecondary}
              accessible={false}
            />
            <ThemedText style={styles.settingsLabel}>Privacy Policy</ThemedText>
          </View>
          <Feather
            name="external-link"
            size={18}
            color={theme.textSecondary}
            accessible={false}
          />
        </Pressable>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Pressable
          onPress={() => openLegalUrl(TERMS_URL, "our Terms of Service")}
          accessibilityLabel="Terms of Service"
          accessibilityRole="link"
          accessibilityHint="Opens our Terms of Service in your browser"
          style={({ pressed }) => [
            styles.settingsItem,
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={styles.settingsItemLeft}>
            <Feather
              name="file-text"
              size={20}
              color={theme.textSecondary}
              accessible={false}
            />
            <ThemedText style={styles.settingsLabel}>
              Terms of Service
            </ThemedText>
          </View>
          <Feather
            name="external-link"
            size={18}
            color={theme.textSecondary}
            accessible={false}
          />
        </Pressable>
      </Card>

      {user && (
        <ThemedText style={[styles.footer, { color: theme.textSecondary }]}>
          Signed in as {user.displayName || user.username}
        </ThemedText>
      )}

      <ThemedText style={[styles.versionLabel, { color: theme.textSecondary }]}>
        {versionLabel}
      </ThemedText>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />

      <DeleteAccountModal
        visible={showDeleteAccountModal}
        onClose={() => setShowDeleteAccountModal(false)}
        onConfirm={handleDeleteAccount}
        showSubscriptionWarning={isPremium}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  settingsItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 48,
  },
  settingsItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    flex: 1,
  },
  settingsItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  settingsLabel: {
    fontSize: 15,
  },
  unitSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  unitOptionRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  unitOption: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    paddingHorizontal: Spacing.md,
  },
  unitOptionLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.lg,
  },
  footer: {
    textAlign: "center",
    fontSize: 12,
    marginTop: Spacing.xl,
  },
  versionLabel: {
    textAlign: "center",
    fontSize: 11,
    marginTop: Spacing.sm,
  },
});
