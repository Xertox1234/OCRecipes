import React from "react";
import { StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getShutterTopInset } from "./shutter-layout";

interface Props {
  label: string | null;
}

/**
 * Positioned to visually align with the (otherwise-unused) spacer slot next
 * to the shutter in ScanScreen's bottom controls row, without CameraView
 * needing to know about ScanScreen's layout — see the design spec's "Pinch-
 * to-zoom" section.
 *
 * `bottom` is derived from `insets.bottom` via `getShutterTopInset` rather
 * than a static constant — a fixed value (this component's previous
 * `bottom: 92`) under-clears the shutter once `insets.bottom` grows on
 * home-indicator devices. See
 * docs/solutions/logic-errors/static-offset-must-derive-from-safe-area-inset-2026-07-15.md
 */
export function ZoomLabel({ label }: Props) {
  const insets = useSafeAreaInsets();
  if (!label) return null;
  return (
    <Text
      style={[styles.label, { bottom: getShutterTopInset(insets.bottom) + 4 }]}
      pointerEvents="none"
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    position: "absolute",
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
