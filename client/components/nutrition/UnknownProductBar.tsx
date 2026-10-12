import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

interface UnknownProductBarProps {
  onScanLabel: () => void;
  onLayout: (height: number) => void;
}

/**
 * Replaces the sticky "Add to Today" bar when the barcode resolved to no
 * product (QA sweep #86): logging an empty "Unknown Product" is never useful,
 * so the primary action is to read the nutrition label instead.
 */
export function UnknownProductBar({
  onScanLabel,
  onLayout,
}: UnknownProductBarProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="unknown-product-bar"
      onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom + Spacing.md,
          backgroundColor: theme.backgroundRoot,
          borderTopColor: theme.border,
        },
      ]}
    >
      <Button
        onPress={onScanLabel}
        accessibilityLabel="Scan the nutrition label"
        accessibilityHint="Opens the camera to read this product's nutrition facts from its label"
      >
        Scan the nutrition label
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
});
