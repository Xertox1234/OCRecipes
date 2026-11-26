import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
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
import type { BarcodeResult, CameraRef, ExpoBarcodeType } from "@/camera";
import { recognizeTextFromPhoto } from "@/camera/utils/recognizeTextFromPhoto";
import { deleteAsync } from "expo-file-system/legacy";
import { preReadLabel, type PhoneLabelRead } from "@/lib/coach-label-pre-read";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { BarcodeViewfinder } from "@/camera/components/BarcodeViewfinder";
import {
  lookupCoachBarcode,
  needsFrontOfPack,
  scannedProductCode,
  settleCoachBarcode,
  type CoachBarcodeLookup,
} from "@/lib/coach-barcode-scan";
import { useAiSharing } from "@/hooks/useAiSharing";
import { withOpacity, Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  ARM_MS,
  INITIAL_PACING,
  labelSpoken,
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
 * Take the label photo, read it on the phone and delete it. Null when there
 * is no photo or it can't be read. Outside the component: React Compiler
 * does not lower a `finally`.
 */
async function readLabelPhoto(
  camera: CameraRef | null,
): Promise<PhoneLabelRead | null> {
  let uri: string | undefined;
  try {
    uri = (await camera?.takePicture())?.uri;
    return uri ? await preReadLabel(uri, recognizeTextFromPhoto) : null;
  } catch {
    return null;
  } finally {
    if (uri) deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

/** Take the front-of-pack photo; null when it can't be taken. */
async function takeFrontPhoto(
  camera: CameraRef | null,
): Promise<string | null> {
  try {
    return (await camera?.takePicture())?.uri ?? null;
  } catch {
    return null;
  }
}

/**
 * Announce once the controls that appear with this step have mounted: iOS
 * does not queue announcements, so one made as focus moves can be dropped.
 */
function announceLater(message: string): () => void {
  const timer = setTimeout(
    () => AccessibilityInfo.announceForAccessibility(message),
    500,
  );
  return () => clearTimeout(timer);
}

/**
 * The live barcode scanner opened from the Coach chat. It reads one product
 * barcode, then asks for its nutrition label, and hands both back to the
 * chat (`settleCoachBarcode`); the chat sends them as one Coach turn.
 * Nothing is looked up or logged here.
 *
 * The scan is paced so it is seen (coach-barcode-pacing-utils): the
 * viewfinder settles before it listens, the code must hold for a few frames,
 * a sweep plays and the digits show. The label photo is read on the phone
 * while a sweep plays over it, and never leaves the phone; the user can skip
 * it, and the card then carries the product's own numbers.
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
  const cameraRef = useRef<CameraRef>(null);
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

  // Read at frame time: past the lock, frames are dropped before any timer.
  const phaseRef = useRef(pacing.phase);
  const pacingRef = useRef(pacing);
  // What the lookup started at the lock found; null while it is out.
  const lookupRef = useRef<CoachBarcodeLookup | null>(null);
  const { status: aiSharing } = useAiSharing();
  const aiAllowedRef = useRef(false);
  // One-shot side effects read these through refs, so a new haptics object
  // (Reduce Motion toggled mid-scan) cannot replay a haptic or a timer.
  const hapticsRef = useRef(haptics);
  const navigationRef = useRef(navigation);
  useLayoutEffect(() => {
    phaseRef.current = pacing.phase;
    pacingRef.current = pacing;
    aiAllowedRef.current = aiSharing?.allowed === true;
    hapticsRef.current = haptics;
    navigationRef.current = navigation;
  });

  const onBarcodeScanned = useCallback((result: BarcodeResult) => {
    const p = phaseRef.current;
    if (p !== "arming" && p !== "hunting" && p !== "tracking") return;
    const code = scannedProductCode(result.data);
    if (!code) return;
    dispatch({ type: "read", code });
    if (lostTimer.current) clearTimeout(lostTimer.current);
    lostTimer.current = setTimeout(() => dispatch({ type: "lost" }), LOST_MS);
  }, []);

  const phase = pacing.phase;
  const code = "code" in pacing ? pacing.code : null;
  useEffect(() => {
    const haptic = hapticsRef.current;
    switch (phase) {
      case "scanning": {
        if (lostTimer.current) clearTimeout(lostTimer.current);
        haptic.impact(Haptics.ImpactFeedbackStyle.Medium);
        AccessibilityInfo.announceForAccessibility("Barcode found");
        // Looked up now, while the sweep plays: by the end of the label step
        // the scanner knows whether the front of the pack is needed.
        const scanned = pacingRef.current;
        lookupRef.current = null;
        if (scanned.phase === "scanning") {
          void lookupCoachBarcode(scanned.code).then((found) => {
            lookupRef.current = found;
          });
        }
        const timer = setTimeout(() => dispatch({ type: "swept" }), SWEEP_MS);
        return () => clearTimeout(timer);
      }
      case "found": {
        haptic.notification(Haptics.NotificationFeedbackType.Success);
        const timer = setTimeout(
          () => dispatch({ type: "revealed" }),
          REVEAL_MS,
        );
        return () => clearTimeout(timer);
      }
      case "label":
        return announceLater(
          "Now take a photo of the nutrition label, or skip it.",
        );
      case "reading": {
        AccessibilityInfo.announceForAccessibility("Reading the label");
        const timer = setTimeout(() => dispatch({ type: "swept" }), SWEEP_MS);
        return () => clearTimeout(timer);
      }
      case "unreadable":
        haptic.notification(Haptics.NotificationFeedbackType.Warning);
        return announceLater(
          "I couldn't read that label. Retake the photo, or skip it.",
        );
      case "labelFound": {
        haptic.notification(Haptics.NotificationFeedbackType.Success);
        const found = pacingRef.current;
        AccessibilityInfo.announceForAccessibility(
          found.phase === "labelFound"
            ? `Label read. ${labelSpoken(found.label)}`
            : "Label read",
        );
        const timer = setTimeout(() => {
          // An AI model reads the front: offered only with AI sharing on,
          // and only when the barcode gives no usable name for the label.
          const shown = pacingRef.current;
          const front =
            aiAllowedRef.current &&
            shown.phase === "labelFound" &&
            needsFrontOfPack(lookupRef.current, shown.label);
          dispatch({ type: "revealed", front });
        }, REVEAL_MS);
        return () => clearTimeout(timer);
      }
      case "front":
        return announceLater(
          "Optional: take a photo of the front of the pack so I can name it and check its allergy statement, or skip it.",
        );
      case "done": {
        const done = pacingRef.current;
        if (done.phase !== "done") return;
        settleCoachBarcode({
          code: done.code,
          ...(done.label && { label: done.label }),
          ...(done.frontUri && { frontUri: done.frontUri }),
        });
        navigationRef.current.goBack();
        return;
      }
    }
  }, [phase]);

  // The label photo is read here, on the phone, and deleted once read.
  const shooting = useRef(false);
  const onShutter = useCallback(async () => {
    const p = phaseRef.current;
    if (shooting.current || (p !== "label" && p !== "unreadable")) return;
    shooting.current = true;
    dispatch({ type: "shutter" });
    hapticsRef.current.impact(Haptics.ImpactFeedbackStyle.Light);
    const label = await readLabelPhoto(cameraRef.current);
    shooting.current = false;
    dispatch({ type: "labelRead", label });
  }, []);

  // The front photo is handed to the chat, which uploads and deletes it.
  const onFrontShutter = useCallback(async () => {
    if (shooting.current || phaseRef.current !== "front") return;
    shooting.current = true;
    dispatch({ type: "shutter" });
    hapticsRef.current.impact(Haptics.ImpactFeedbackStyle.Light);
    const uri = await takeFrontPhoto(cameraRef.current);
    shooting.current = false;
    if (!mountedRef.current) {
      // Closed while the photo was taken: nothing will send it.
      if (uri) deleteAsync(uri, { idempotent: true }).catch(() => {});
      return;
    }
    dispatch({ type: "frontTaken", uri });
  }, []);

  const onSkip = useCallback(() => {
    const p = phaseRef.current;
    if (
      shooting.current ||
      (p !== "label" && p !== "unreadable" && p !== "front")
    )
      return;
    // Closed at once: a shutter tap in the same frame cannot start a photo.
    phaseRef.current = "done";
    dispatch({ type: "skip" });
  }, []);

  // The bottom card and controls' height: the label frame centres in the
  // space above them, so it never sits under them on a small phone.
  const [bottomHeight, setBottomHeight] = useState(0);

  // However the screen goes away (close button, back gesture), the chat
  // stops waiting. A no-op after a read.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
      settleCoachBarcode(null);
    },
    [],
  );

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
  const frontStep =
    phase === "front" ||
    phase === "frontShot" ||
    (phase === "done" && "frontUri" in pacing);
  // Controls stay mounted, disabled, while a photo is read or taken.
  const busy = phase === "reading" || phase === "frontShot";
  const labelStep =
    frontStep ||
    phase === "label" ||
    phase === "reading" ||
    phase === "unreadable" ||
    phase === "labelFound" ||
    (phase === "done" && "label" in pacing);
  const stepText = frontStep
    ? "Step 3: front of pack (optional)"
    : labelStep
      ? "Step 2: nutrition label"
      : "Step 1: barcode";
  return (
    <View style={styles.container} accessibilityViewIsModal>
      {/* accessible={false} keeps VoiceOver off the camera preview */}
      <View accessible={false} style={StyleSheet.absoluteFill}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeTypes={PRODUCT_BARCODE_TYPES}
          ref={cameraRef}
          isActive={isFocused && phase !== "done"}
          onBarcodeScanned={onBarcodeScanned}
        />
      </View>

      <BarcodeViewfinder
        shape={labelStep ? "label" : "barcode"}
        bottomInset={labelStep ? bottomHeight : 0}
        confidence={labelStep ? 0 : pacingConfidence(pacing)}
        armed={phase !== "arming"}
        sweeping={phase === "scanning" || phase === "reading"}
        found={phase === "found" || phase === "labelFound" || phase === "done"}
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
        style={[styles.bottom, { bottom: insets.bottom + Spacing.xl }]}
        onLayout={(e) =>
          setBottomHeight(
            e.nativeEvent.layout.height + insets.bottom + Spacing.xl,
          )
        }
      >
        <View
          style={[
            styles.hint,
            { backgroundColor: withOpacity(theme.backgroundRoot, 0.85) },
          ]}
          // One VoiceOver stop for the step, the title and the body.
          accessible
          accessibilityLabel={`${stepText}. ${hint.title}. ${
            phase === "found" && code
              ? code.split("").join(" ")
              : phase === "labelFound" && "label" in pacing && pacing.label
                ? labelSpoken(pacing.label)
                : hint.body
          }`}
        >
          <Text style={[styles.hintStep, { color: theme.text }]}>
            {stepText}
          </Text>
          <Text style={[styles.hintTitle, { color: theme.text }]}>
            {hint.title}
          </Text>
          <Text
            style={[
              styles.hintBody,
              (phase === "found" || phase === "labelFound") &&
                styles.hintDigits,
              { color: theme.text },
            ]}
          >
            {hint.body}
          </Text>
        </View>

        {/* Kept mounted while the photo is read, so VoiceOver focus stays. */}
        {(phase === "label" ||
          phase === "unreadable" ||
          phase === "front" ||
          busy) && (
          <View style={styles.controls}>
            <Pressable
              onPress={onSkip}
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              style={[
                styles.skipButton,
                { backgroundColor: withOpacity(theme.backgroundRoot, 0.85) },
                busy && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                frontStep ? "Skip the front of the pack" : "Skip the label"
              }
              accessibilityHint={
                frontStep
                  ? "Logs it from the label alone"
                  : "Uses the product's own numbers"
              }
            >
              <Text style={[styles.skipText, { color: theme.text }]}>Skip</Text>
            </Pressable>
            <Pressable
              onPress={() => void (frontStep ? onFrontShutter() : onShutter())}
              disabled={busy}
              accessibilityState={{ disabled: busy, busy }}
              style={[styles.shutter, busy && styles.disabled]}
              accessibilityRole="button"
              accessibilityHint={
                frontStep
                  ? "The AI reads the product's name and allergy statement from it."
                  : "Reads the label on your phone. The photo isn't sent."
              }
              accessibilityLabel={
                frontStep
                  ? "Take a photo of the front of the pack"
                  : phase === "unreadable"
                    ? "Retake the label photo"
                    : "Take a photo of the nutrition label"
              }
            >
              <View style={styles.shutterInner} />
            </Pressable>
            {/* Balances the row so the shutter sits in the middle. */}
            <View style={styles.skipButton} />
          </View>
        )}
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
  bottom: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    gap: Spacing.lg,
  },
  hint: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  hintStep: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: Spacing.xs,
    textAlign: "center",
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
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  skipButton: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  skipText: {
    fontSize: 16,
    fontWeight: "600",
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#FFFFFF", // hardcoded — live-camera overlay
    justifyContent: "center",
    alignItems: "center",
  },
  disabled: {
    opacity: 0.4,
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF", // hardcoded — live-camera overlay
  },
});
