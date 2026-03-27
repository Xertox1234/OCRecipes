import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Image,
  AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";

import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { confirmFrontLabel } from "@/lib/photo-upload";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type NavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "FrontLabelConfirm"
>;
type ScreenRoute = RouteProp<RootStackParamList, "FrontLabelConfirm">;

export default function FrontLabelConfirmScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ScreenRoute>();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { imageUri, barcode, sessionId, data } = route.params;

  const [error, setError] = useState<string | null>(null);

  const confirmMutation = useMutation({
    mutationFn: () => confirmFrontLabel(sessionId, barcode),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(
        "Product details saved successfully",
      );
      // Pop back to NutritionDetail
      navigation.pop(2);
    },
    onError: (err: Error) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err.message || "Failed to save product details");
    },
  });

  const handleConfirm = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setError(null);
    confirmMutation.mutate();
  }, [confirmMutation]);

  const handleRetake = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.replace("Scan", { mode: "front-label", verifyBarcode: barcode });
  }, [navigation, barcode]);

  const hasAnyData =
    data.brand || data.productName || data.netWeight || data.claims.length > 0;

  return (
    <ThemedView
      style={[styles.container, { paddingBottom: insets.bottom + Spacing.md }]}
      accessibilityViewIsModal
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Photo thumbnail */}
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: imageUri }}
            style={[
              styles.thumbnail,
              { borderColor: withOpacity(theme.border, 0.3) },
            ]}
            accessibilityLabel="Front of package photo"
          />
        </View>

        {/* Confidence warning */}
        {data.confidence < 0.7 && (
          <View
            style={[
              styles.warningBanner,
              { backgroundColor: withOpacity(theme.warning, 0.12) },
            ]}
            accessibilityRole="alert"
          >
            <Feather name="alert-triangle" size={16} color={theme.warning} />
            <ThemedText style={[styles.warningText, { color: theme.warning }]}>
              Low confidence — some details may be inaccurate
            </ThemedText>
          </View>
        )}

        {/* Extracted data card */}
        <Card style={styles.dataCard}>
          <ThemedText style={styles.sectionTitle}>Product Details</ThemedText>

          <DataRow label="Brand" value={data.brand} theme={theme} />
          <DataRow label="Product" value={data.productName} theme={theme} />
          <DataRow label="Net Weight" value={data.netWeight} theme={theme} />

          {/* Claims chips */}
          <View style={styles.claimsSection}>
            <ThemedText style={styles.claimsLabel}>Claims</ThemedText>
            {data.claims.length > 0 ? (
              <View style={styles.chipContainer}>
                {data.claims.map((claim, index) => (
                  <View
                    key={index}
                    style={[
                      styles.chip,
                      { backgroundColor: withOpacity(theme.success, 0.12) },
                    ]}
                  >
                    <ThemedText
                      style={[styles.chipText, { color: theme.success }]}
                    >
                      {claim}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : (
              <ThemedText
                style={[styles.notDetected, { color: theme.textSecondary }]}
              >
                No claims detected
              </ThemedText>
            )}
          </View>
        </Card>

        {!hasAnyData && (
          <ThemedText
            style={[styles.emptyHint, { color: theme.textSecondary }]}
          >
            No product details were detected. Try retaking the photo with better
            lighting.
          </ThemedText>
        )}

        {error && (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: withOpacity(theme.error, 0.12) },
            ]}
            accessibilityRole="alert"
          >
            <ThemedText style={[styles.errorText, { color: theme.error }]}>
              {error}
            </ThemedText>
          </View>
        )}
      </ScrollView>

      {/* Action buttons */}
      <View style={styles.buttonRow}>
        <Button
          onPress={handleRetake}
          variant="secondary"
          style={styles.retakeButton}
          accessibilityLabel="Retake front of package photo"
        >
          Retake
        </Button>
        <Button
          onPress={handleConfirm}
          loading={confirmMutation.isPending}
          disabled={confirmMutation.isPending}
          style={styles.confirmButton}
          accessibilityLabel="Confirm and save product details"
        >
          Looks Good
        </Button>
      </View>
    </ThemedView>
  );
}

function DataRow({
  label,
  value,
  theme,
}: {
  label: string;
  value: string | null;
  theme: { textSecondary: string };
}) {
  return (
    <View style={styles.dataRow}>
      <ThemedText style={styles.dataLabel}>{label}</ThemedText>
      {value ? (
        <ThemedText style={styles.dataValue}>{value}</ThemedText>
      ) : (
        <ThemedText
          style={[styles.notDetected, { color: theme.textSecondary }]}
        >
          Not detected
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  imageContainer: {
    alignItems: "center",
  },
  thumbnail: {
    width: 200,
    height: 200,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  warningText: {
    fontSize: 13,
    flex: 1,
  },
  dataCard: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  dataRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  dataLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
  dataValue: {
    fontSize: 15,
    flex: 1,
    textAlign: "right",
    marginLeft: Spacing.md,
  },
  notDetected: {
    fontSize: 14,
    fontStyle: "italic",
  },
  claimsSection: {
    marginTop: Spacing.xs,
  },
  claimsLabel: {
    fontSize: 15,
    fontWeight: "500",
    marginBottom: Spacing.xs,
  },
  chipContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  emptyHint: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  errorBanner: {
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  errorText: {
    fontSize: 13,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  retakeButton: {
    flex: 1,
  },
  confirmButton: {
    flex: 2,
  },
});
