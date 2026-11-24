import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, Text, StyleSheet, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { CameraView, useCameraPermissions } from "@/camera";
import type { BarcodeResult, ExpoBarcodeType } from "@/camera";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  scannedProductCode,
  settleCoachBarcode,
} from "@/lib/coach-barcode-scan";
import { withOpacity, Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavProp = NativeStackNavigationProp<
  RootStackParamList,
  "CoachBarcodeScan"
>;

// Product barcodes only: a QR code or a shipping label is not a food.
const PRODUCT_BARCODE_TYPES: ExpoBarcodeType[] = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
];

/**
 * The live barcode scanner opened from the Coach chat. It reads one product
 * barcode, hands the number back to the chat (`settleCoachBarcode`) and
 * closes; the chat sends it as a Coach turn. Nothing is looked up or logged
 * here.
 */
export default function CoachBarcodeScanScreen() {
  const navigation = useNavigation<NavProp>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { permission, requestPermission } = useCameraPermissions();

  // The decoder reports the same barcode on every frame: the ref makes the
  // first read the only one, the state turns the camera off.
  const readRef = useRef(false);
  const [hasRead, setHasRead] = useState(false);

  const onBarcodeScanned = useCallback(
    (result: BarcodeResult) => {
      if (readRef.current) return;
      const code = scannedProductCode(result.data);
      if (!code) return;
      readRef.current = true;
      setHasRead(true);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      settleCoachBarcode(code);
      navigation.goBack();
    },
    [haptics, navigation],
  );

  // However the screen goes away (close button, back gesture), the chat
  // stops waiting. A no-op after a read.
  useEffect(() => () => settleCoachBarcode(null), []);

  // Auto-request only the re-askable state (see BatchScanScreen).
  const permissionStatus = permission?.status;
  useEffect(() => {
    if (permissionStatus === "undetermined") {
      void requestPermission();
    }
  }, [permissionStatus, requestPermission]);

  if (permission?.status !== "granted") {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        accessibilityViewIsModal
      >
        <Text style={[styles.permissionText, { color: theme.text }]}>
          Camera permission is required to scan a barcode.
        </Text>
        <Pressable
          onPress={() => {
            if (permission?.canAskAgain) {
              void requestPermission();
            } else {
              void Linking.openSettings();
            }
          }}
          style={[
            styles.permissionButton,
            { backgroundColor: theme.accentSolid },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            permission?.canAskAgain
              ? "Grant camera permission"
              : "Open settings"
          }
        >
          <Text
            style={[styles.permissionButtonText, { color: theme.buttonText }]}
          >
            {permission?.canAskAgain ? "Grant Permission" : "Open Settings"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.closeLink}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={{ color: theme.link }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container} accessibilityViewIsModal>
      {/* accessible={false} keeps VoiceOver off the camera preview */}
      <View accessible={false} style={StyleSheet.absoluteFill}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeTypes={PRODUCT_BARCODE_TYPES}
          isActive={isFocused && !hasRead}
          onBarcodeScanned={onBarcodeScanned}
        />
      </View>

      <Pressable
        onPress={() => navigation.goBack()}
        style={[
          styles.closeButton,
          {
            top: insets.top + Spacing.sm,
            backgroundColor: withOpacity(theme.backgroundRoot, 0.7),
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Close scanner"
        hitSlop={12}
      >
        <Feather name="x" size={24} color={theme.text} />
      </Pressable>

      <View
        style={[
          styles.hint,
          {
            bottom: insets.bottom + Spacing.xl,
            backgroundColor: withOpacity(theme.backgroundRoot, 0.85),
          },
        ]}
      >
        <Text style={[styles.hintTitle, { color: theme.text }]}>
          Point the camera at a barcode
        </Text>
        <Text style={[styles.hintBody, { color: theme.text }]}>
          The Coach will find the product and offer to log it.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000", // hardcoded
  },
  permissionText: {
    fontSize: 16,
    textAlign: "center",
    marginHorizontal: Spacing.xl,
    marginTop: 200,
  },
  permissionButton: {
    marginTop: Spacing.lg,
    marginHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  closeLink: {
    marginTop: Spacing.lg,
    padding: Spacing.sm,
    alignSelf: "center",
  },
  closeButton: {
    position: "absolute",
    left: Spacing.md,
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  hint: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  hintTitle: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  hintBody: {
    fontSize: 14,
    marginTop: Spacing.xs,
    textAlign: "center",
  },
});
