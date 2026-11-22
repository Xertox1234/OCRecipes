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
  /** Leave the scan screen. */
  onCancel: () => void;
}

const COPY = {
  undetermined: {
    title: "Camera Access",
    body: "OCRecipes needs your camera to scan barcodes and food labels.",
    action: "Allow Camera",
    actionLabel: "Allow camera access",
  },
  denied: {
    title: "Camera Blocked",
    body: "Enable camera access in Settings to scan products.",
    action: "Open Settings",
    actionLabel: "Open Settings to enable camera",
  },
} as const;

/**
 * Full-screen stand-in for the camera until permission is granted. It is the
 * whole of the Scan screen (a headerless fullScreenModal) while shown, so both
 * states keep a Cancel and trap VoiceOver focus (docs/rules/accessibility.md).
 */
export function CameraPermissionGate({
  status,
  onRequestPermission,
  onCancel,
}: CameraPermissionGateProps) {
  const { theme } = useTheme();
  const copy = COPY[status];
  const onAction =
    status === "undetermined"
      ? onRequestPermission
      : () => {
          void Linking.openSettings();
        };

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.permissionContainer,
        { backgroundColor: theme.backgroundDefault },
      ]}
    >
      <Text style={[styles.permissionTitle, { color: theme.text }]}>
        {copy.title}
      </Text>
      <Text style={[styles.permissionBody, { color: theme.textSecondary }]}>
        {copy.body}
      </Text>
      <TouchableOpacity
        style={[styles.permissionBtn, { backgroundColor: theme.accentSolid }]}
        onPress={onAction}
        accessibilityLabel={copy.actionLabel}
        accessibilityRole="button"
      >
        <Text style={[styles.permissionBtnText, { color: theme.buttonText }]}>
          {copy.action}
        </Text>
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
  // Fill and text colour come from the theme (accentSolid: 5.48:1 under
  // white). The old hardcoded #007AFF was about 4:1, below AA for 16px text.
  permissionBtn: {
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
    marginTop: 8,
  },
  permissionBtnText: { fontWeight: "700", fontSize: 16 },
  permissionCancel: { paddingVertical: 12 },
  permissionCancelText: { fontSize: 15 },
});
