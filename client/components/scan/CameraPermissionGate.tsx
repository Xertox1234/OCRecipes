import React from "react";
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTheme } from "@/hooks/useTheme";

interface CameraPermissionGateProps {
  /** `"undetermined"` shows the ask; `"denied"` shows the Settings redirect. */
  status: "undetermined" | "denied";
  onRequestPermission: () => void;
  /** Leave the scan screen (denied state only). */
  onCancel: () => void;
}

/** Full-screen stand-in for the camera until permission is granted. */
export function CameraPermissionGate({
  status,
  onRequestPermission,
  onCancel,
}: CameraPermissionGateProps) {
  const { theme } = useTheme();

  if (status === "undetermined") {
    return (
      <View
        style={[
          styles.permissionContainer,
          { backgroundColor: theme.backgroundDefault },
        ]}
      >
        <Text style={[styles.permissionTitle, { color: theme.text }]}>
          Camera Access
        </Text>
        <Text style={[styles.permissionBody, { color: theme.textSecondary }]}>
          OCRecipes needs your camera to scan barcodes and food labels.
        </Text>
        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={onRequestPermission}
          accessibilityLabel="Allow camera access"
          accessibilityRole="button"
        >
          <Text style={styles.permissionBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.permissionContainer,
        { backgroundColor: theme.backgroundDefault },
      ]}
    >
      <Text style={[styles.permissionTitle, { color: theme.text }]}>
        Camera Blocked
      </Text>
      <Text style={[styles.permissionBody, { color: theme.textSecondary }]}>
        Enable camera access in Settings to scan products.
      </Text>
      <TouchableOpacity
        style={styles.permissionBtn}
        onPress={() => Linking.openSettings()}
        accessibilityLabel="Open Settings to enable camera"
        accessibilityRole="button"
      >
        <Text style={styles.permissionBtnText}>Open Settings</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.permissionCancel}
        onPress={onCancel}
        accessibilityLabel="Cancel and go back"
        accessibilityRole="button"
      >
        <Text
          style={[styles.permissionCancelText, { color: theme.textSecondary }]}
        >
          Cancel
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  permissionTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  permissionBody: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  permissionBtn: {
    backgroundColor: "#007AFF", // hardcoded — iOS system blue, intentional
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 8,
  },
  permissionBtnText: { color: "#FFF", fontWeight: "700", fontSize: 16 }, // hardcoded — camera overlay
  permissionCancel: { paddingVertical: 12 },
  permissionCancelText: { fontSize: 15 },
});
