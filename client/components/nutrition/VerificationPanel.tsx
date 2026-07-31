import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { VerificationBadge } from "@/components/VerificationBadge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { VerificationLevel } from "@shared/types/verification";

interface VerificationPanelProps {
  verificationLevel: VerificationLevel;
  hasFrontLabelData: boolean;
  /** The screen owns the navigation call — it holds `barcode` and the route shape. */
  onAddProductDetails: () => void;
}

export function VerificationPanel({
  verificationLevel,
  hasFrontLabelData,
  onAddProductDetails,
}: VerificationPanelProps) {
  const { theme } = useTheme();

  return (
    <View style={styles.verificationSection}>
      <VerificationBadge level={verificationLevel} />

      {/* Retroactive front-label CTA for verified products without front-label data */}
      {verificationLevel !== "unverified" && !hasFrontLabelData && (
        <Pressable
          onPress={onAddProductDetails}
          accessibilityLabel="Scan front of package to add product details"
          accessibilityRole="button"
          style={[
            styles.verifyPrompt,
            { backgroundColor: withOpacity(theme.textSecondary, 0.06) },
          ]}
        >
          <Feather name="package" size={18} color={theme.textSecondary} />
          <View style={{ flex: 1 }}>
            <ThemedText
              type="body"
              style={{ color: theme.textSecondary, fontWeight: "600" }}
            >
              Add product details
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Scan front of package
            </ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  verificationSection: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  verifyPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
});
