import React, { useCallback, useEffect, useMemo } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  ScrollView,
  Switch,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  useHealthKitSettings,
  useUpdateHealthKitSettings,
  useSyncHealthKit,
  healthKitAvailable,
  type HealthKitSyncSetting,
} from "@/hooks/useHealthKit";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface DataTypeConfig {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  description: string;
}

const DATA_TYPES: DataTypeConfig[] = [
  {
    key: "weight",
    label: "Weight",
    icon: "trending-down",
    description: "Sync body weight measurements",
  },
  {
    key: "steps",
    label: "Steps",
    icon: "activity",
    description: "Read daily step counts",
  },
  {
    key: "workouts",
    label: "Workouts",
    icon: "zap",
    description: "Sync workout sessions and calories burned",
  },
  {
    key: "active_energy",
    label: "Active Energy",
    icon: "heart",
    description: "Read active calories burned",
  },
  {
    key: "sleep",
    label: "Sleep",
    icon: "moon",
    description: "Read sleep analysis data",
  },
];

function formatLastSync(dateStr: string | null): string {
  if (!dateStr) return "Never synced";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const SyncToggleRow = React.memo(function SyncToggleRow({
  config,
  setting,
  onToggle,
}: {
  config: DataTypeConfig;
  setting: HealthKitSyncSetting | undefined;
  onToggle: (dataType: string, enabled: boolean) => void;
}) {
  const { theme } = useTheme();
  const isEnabled = setting?.enabled ?? false;
  const lastSync = setting?.lastSyncAt ?? null;

  return (
    <View style={styles.toggleRow}>
      <View
        style={[
          styles.toggleIcon,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <Feather name={config.icon} size={20} color={theme.text} />
      </View>
      <View style={styles.toggleContent}>
        <ThemedText type="body">{config.label}</ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {config.description}
        </ThemedText>
        {isEnabled && (
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary, marginTop: 2 }}
          >
            {formatLastSync(lastSync)}
          </ThemedText>
        )}
      </View>
      <Switch
        value={isEnabled}
        onValueChange={(value) => onToggle(config.key, value)}
        accessibilityLabel={`Toggle ${config.label} sync`}
        trackColor={{
          false: theme.backgroundSecondary,
          true: withOpacity(theme.link, 0.4),
        }}
        thumbColor={isEnabled ? theme.link : theme.textSecondary}
      />
    </View>
  );
});

export default function HealthKitSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { isPremium } = usePremiumContext();

  const { data: settings = [], isLoading } = useHealthKitSettings();
  const updateSettings = useUpdateHealthKitSettings();
  const syncHealthKit = useSyncHealthKit();

  const settingsMap = useMemo(() => {
    const map = new Map<string, HealthKitSyncSetting>();
    for (const s of settings) {
      map.set(s.dataType, s);
    }
    return map;
  }, [settings]);

  useEffect(() => {
    if (syncHealthKit.isSuccess && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility("Sync complete");
    }
  }, [syncHealthKit.isSuccess]);

  const handleToggle = useCallback(
    (dataType: string, enabled: boolean) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      updateSettings.mutate([{ dataType, enabled }]);
    },
    [haptics, updateSettings],
  );

  const handleSyncNow = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    // In production, this would read from HealthKit native APIs first,
    // then push data to the server. For now, trigger an empty sync
    // to demonstrate the flow.
    syncHealthKit.mutate({});
  }, [haptics, syncHealthKit]);

  const enabledCount = settings.filter((s) => s.enabled).length;

  if (!healthKitAvailable) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={{
          padding: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        }}
      >
        <Card elevation={1} style={styles.infoCard}>
          <Feather name="alert-circle" size={32} color={theme.textSecondary} />
          <ThemedText
            type="body"
            style={{ textAlign: "center", marginTop: Spacing.md }}
          >
            Apple Health integration is only available on iOS devices.
          </ThemedText>
        </Card>
      </ScrollView>
    );
  }

  if (!isPremium) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
        contentContainerStyle={{
          padding: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
        }}
      >
        <Card elevation={1} style={styles.infoCard}>
          <Feather name="lock" size={32} color={theme.link} />
          <ThemedText
            type="h4"
            style={{ textAlign: "center", marginTop: Spacing.md }}
          >
            Premium Feature
          </ThemedText>
          <ThemedText
            type="body"
            style={{
              textAlign: "center",
              marginTop: Spacing.sm,
              color: theme.textSecondary,
            }}
          >
            Apple Health sync requires a premium subscription. Upgrade to sync
            weight, workouts, steps, and more.
          </ThemedText>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        padding: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
      }}
    >
      {/* Header info */}
      <Card elevation={1} style={styles.headerCard}>
        <View style={styles.headerRow}>
          <Feather name="heart" size={24} color={theme.link} />
          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            <ThemedText type="h4">Apple Health</ThemedText>
            <ThemedText
              type="small"
              style={{ color: theme.textSecondary, marginTop: 2 }}
            >
              {enabledCount > 0
                ? `${enabledCount} data type${enabledCount !== 1 ? "s" : ""} syncing`
                : "No data types enabled"}
            </ThemedText>
          </View>
        </View>
      </Card>

      {/* Data type toggles */}
      <ThemedText
        type="h4"
        style={{ marginTop: Spacing.xl, marginBottom: Spacing.md }}
      >
        Data Types
      </ThemedText>
      <Card elevation={1} style={styles.toggleCard}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={theme.link} />
          </View>
        ) : (
          DATA_TYPES.map((config, index) => (
            <React.Fragment key={config.key}>
              {index > 0 && (
                <View
                  style={[styles.divider, { backgroundColor: theme.border }]}
                />
              )}
              <SyncToggleRow
                config={config}
                setting={settingsMap.get(config.key)}
                onToggle={handleToggle}
              />
            </React.Fragment>
          ))
        )}
      </Card>

      {/* Sync Now button */}
      <Pressable
        onPress={handleSyncNow}
        disabled={syncHealthKit.isPending || enabledCount === 0}
        accessibilityLabel="Sync now with Apple Health"
        accessibilityRole="button"
        accessibilityState={{
          disabled: syncHealthKit.isPending || enabledCount === 0,
        }}
        style={({ pressed }) => [
          styles.syncButton,
          {
            backgroundColor:
              enabledCount === 0 ? theme.backgroundSecondary : theme.link,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {syncHealthKit.isPending ? (
          <ActivityIndicator size="small" color={theme.buttonText} />
        ) : (
          <>
            <Feather
              name="refresh-cw"
              size={18}
              color={
                enabledCount === 0 ? theme.textSecondary : theme.buttonText
              }
            />
            <ThemedText
              style={[
                styles.syncButtonText,
                {
                  color:
                    enabledCount === 0 ? theme.textSecondary : theme.buttonText,
                },
              ]}
            >
              Sync Now
            </ThemedText>
          </>
        )}
      </Pressable>

      {syncHealthKit.isSuccess && (
        <ThemedText
          type="small"
          accessibilityLiveRegion="polite"
          style={{
            textAlign: "center",
            color: theme.success,
            marginTop: Spacing.sm,
          }}
        >
          Sync complete
        </ThemedText>
      )}

      {/* Note about native module */}
      <Card
        elevation={0}
        style={[
          styles.noteCard,
          { backgroundColor: withOpacity(theme.info, 0.08) },
        ]}
      >
        <Feather
          name="info"
          size={16}
          color={theme.info}
          style={{ marginRight: Spacing.sm }}
        />
        <ThemedText
          type="small"
          style={{ flex: 1, color: theme.textSecondary }}
        >
          HealthKit data is read from your device and synced to your OCRecipes
          account. Your health data stays private and is never shared.
        </ThemedText>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  infoCard: {
    alignItems: "center",
    padding: Spacing.xl,
  },
  headerCard: {
    padding: Spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  toggleCard: {
    padding: 0,
    overflow: "hidden",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  toggleIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  toggleContent: {
    flex: 1,
  },
  divider: {
    height: 1,
    marginLeft: Spacing.lg + 40 + Spacing.md,
  },
  loadingContainer: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.xl,
    gap: Spacing.sm,
  },
  syncButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    marginTop: Spacing.lg,
    borderRadius: BorderRadius.sm,
  },
});
