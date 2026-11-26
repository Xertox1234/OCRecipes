import React, { useCallback, useEffect, useReducer, useRef } from "react";
import {
  AccessibilityInfo,
  View,
  Pressable,
  Text,
  StyleSheet,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { CameraView, useCameraPermissions } from "@/camera";
import type { BarcodeResult, ExpoBarcodeType } from "@/camera";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { BarcodeViewfinder } from "@/camera/components/BarcodeViewfinder";
import {
  scannedProductCode,
  settleCoachBarcode,
} from "@/lib/coach-barcode-scan";
import { withOpacity, Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  ARM_MS,
  INITIAL_PACING,
  LOST_MS,
  REVEAL_MS,
  SWEEP_MS,
  pacingConfidence,
  pacingHint,
  pacingReducer,
} from "./coach-barcode-pacing-utils";

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
 * barcode and hands the number back to the chat (`settleCoachBarcode`); the
 * chat sends it as a Coach turn. Nothing is looked up or logged here.
 *
 * The read is paced so it is seen (coach-barcode-pacing-utils): the
 * viewfinder settles before it listens, the code must hold for a few frames,
 * and the number goes to the chat at the lock, so the lookup runs while the
 * sweep and the reveal play, before the screen closes.
 */
export default function CoachBarcodeScanScreen() {
  const navigation = useNavigation<NavProp>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const { permission, requestPermission } = useCameraPermissions();
  const [pacing, dispatch] = useReducer(pacingReducer, INITIAL_PACING);
  const granted = permission?.status === "granted";

  // The viewfinder listens only once it has settled on screen.
  useEffect(() => {
    if (!granted || !isFocused) return;
    const timer = setTimeout(() => dispatch({ type: "armed" }), ARM_MS);
    return () => clearTimeout(timer);
  }, [granted, isFocused]);

  // The decoder reports a code on every frame it sees one; a gap means the
  // barcode left the frame, and the hold starts over.
  const lostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (lostTimer.current) clearTimeout(lostTimer.current);
    },
    [],
  );

  const onBarcodeScanned = useCallback((result: BarcodeResult) => {
    const code = scannedProductCode(result.data);
    if (!code) return;
    dispatch({ type: "read", code });
    if (lostTimer.current) clearTimeout(lostTimer.current);
    lostTimer.current = setTimeout(() => dispatch({ type: "lost" }), LOST_MS);
  }, []);

  const phase = pacing.phase;
  const code = "code" in pacing ? pacing.code : null;
  useEffect(() => {
    if (phase === "scanning" && code) {
      if (lostTimer.current) clearTimeout(lostTimer.current);
      // The chat starts the lookup now, while the sweep plays.
      settleCoachBarcode(code);
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      AccessibilityInfo.announceForAccessibility(
        "Barcode found. Looking it up.",
      );
      const timer = setTimeout(() => dispatch({ type: "swept" }), SWEEP_MS);
      return () => clearTimeout(timer);
    }
    if (phase === "found") {
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      const timer = setTimeout(() => dispatch({ type: "revealed" }), REVEAL_MS);
      return () => clearTimeout(timer);
    }
    if (phase === "done") navigation.goBack();
  }, [phase, code, haptics, navigation]);

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

  if (!granted) {
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

  const hint = pacingHint(pacing);
  return (
    <View style={styles.container} accessibilityViewIsModal>
      {/* accessible={false} keeps VoiceOver off the camera preview */}
      <View accessible={false} style={StyleSheet.absoluteFill}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeTypes={PRODUCT_BARCODE_TYPES}
          isActive={isFocused && phase !== "done"}
          onBarcodeScanned={onBarcodeScanned}
        />
      </View>

      <BarcodeViewfinder
        confidence={pacingConfidence(pacing)}
        armed={phase !== "arming"}
        sweeping={phase === "scanning"}
        found={phase === "found" || phase === "done"}
        sweepMs={SWEEP_MS}
        reducedMotion={reducedMotion}
      />

      <Pressable
        onPress={() => navigation.goBack()}
        style={[
          styles.closeButton,
          {
            top: insets.top + Spacing.sm,
            backgroundColor: withOpacity(theme.backgroundRoot, 0.85),
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
          {hint.title}
        </Text>
        <Text
          style={[
            styles.hintBody,
            code && phase !== "tracking" && styles.hintDigits,
            { color: theme.text },
          ]}
        >
          {hint.body}
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
    minHeight: 44,
    justifyContent: "center",
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
  hintDigits: {
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    letterSpacing: 2,
  },
});
