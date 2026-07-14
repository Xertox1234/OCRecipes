import React from "react";
import { StyleSheet, Text } from "react-native";

interface Props {
  label: string | null;
}

/**
 * Positioned to visually align with the (otherwise-unused) spacer slot next
 * to the shutter in ScanScreen's bottom controls row, without CameraView
 * needing to know about ScanScreen's layout — see the design spec's "Pinch-
 * to-zoom" section.
 */
export function ZoomLabel({ label }: Props) {
  if (!label) return null;
  return (
    <Text style={styles.label} pointerEvents="none">
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    position: "absolute",
    bottom: 92, // px — clears the 72px shutter + insets.bottom padding below it
    alignSelf: "center",
    color: "#FFF", // hardcoded — camera overlay
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 13,
    fontWeight: "600",
  },
});
