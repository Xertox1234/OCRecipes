import React, { ComponentProps, useCallback } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  ScrollView,
  Platform,
  Alert,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { usePremiumContext } from "@/context/PremiumContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { Spacing } from "@/constants/theme";
import type { ProfileScreenNavigationProp } from "@/types/navigation";

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
  { id: "subscription", icon: "credit-card", label: "Subscription" },
  { id: "signout", icon: "log-out", label: "Sign Out", danger: true },
];

export default function SettingsScreen() {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { logout, user } = useAuthContext();
  const { isPremium } = usePremiumContext();

  const healthKitUnlocked = usePremiumFeature("healthKitSync");
  const glp1Unlocked = usePremiumFeature("glp1Companion");
  const goalsUnlocked = usePremiumFeature("adaptiveGoals");

  const [showUpgradeModal, setShowUpgradeModal] = React.useState(false);

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
    ],
  );

  const visibleItems = SETTINGS_ITEMS.filter(
    (item) => !item.iosOnly || Platform.OS === "ios",
  );

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
                      importantForAccessibility="no-hide-descendants"
                    />
                  )}
                  {!item.danger && (
                    <Feather
                      name="chevron-right"
                      size={18}
                      color={theme.textSecondary}
                    />
                  )}
                </View>
              </Pressable>
            </React.Fragment>
          );
        })}
      </Card>

      {user && (
        <ThemedText style={[styles.footer, { color: theme.textSecondary }]}>
          Signed in as {user.displayName || user.username}
        </ThemedText>
      )}

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: Spacing.lg,
  },
  footer: {
    textAlign: "center",
    fontSize: 12,
    marginTop: Spacing.xl,
  },
});
