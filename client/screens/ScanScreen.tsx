import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import ConfettiCannon from "react-native-confetti-cannon";
import {
  AccessibilityInfo,
  Alert,
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  Pressable,
  Linking,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import {
  useNavigation,
  useIsFocused,
  useRoute,
} from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import { useTheme } from "@/hooks/useTheme";
import { getConfidenceTier, getConfidenceHapticType } from "@/lib/confidence";
import { usePremiumCamera } from "@/hooks/usePremiumFeatures";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  useCameraPermissions,
  CameraView,
  recognizeTextFromPhoto,
  type BarcodeResult,
  type CameraRef,
} from "@/camera";
import { useAutoAdvanceTimer } from "@/camera/hooks/useAutoAdvanceTimer";

import { scanPhaseReducer } from "@/camera/reducers/scan-phase-reducer";
import { CoachHint } from "@/camera/components/CoachHint";
import { ScanReticle } from "@/camera/components/ScanReticle";
import { StepPill } from "@/camera/components/StepPill";
import { ProductChip } from "@/camera/components/ProductChip";
import { getProductChipVariant } from "@/camera/components/ProductChip-utils";
import { ScanFlashOverlay } from "@/camera/components/ScanFlashOverlay";
import { ScanSonarRing } from "@/camera/components/ScanSonarRing";
import { getCoachMessage } from "@/camera/components/CoachHint-utils";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { logger } from "@/lib/logger";
import { uploadPhotoForAnalysis } from "@/lib/photo-upload";
import {
  resolveSmartConfirmAction,
  evaluateBarcodeDetection,
  type BarcodeTrackingState,
} from "@/screens/scan-screen-utils";
import {
  buildLoadingConfirmCard,
  buildLoadedConfirmCard,
  buildFetchErrorConfirmCard,
  buildScannedItemPayload,
  buildSuccessToastMessage,
  canLog,
  getScanOverlayA11y,
  type ConfirmCardState,
} from "@/screens/ScanScreenConfirmOverlay-utils";
import { ThemedText } from "@/components/ThemedText";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useToast } from "@/context/ToastContext";
import {
  withOpacity,
  Spacing,
  BorderRadius,
  FontFamily,
} from "@/constants/theme";
import type { ScanScreenNavigationProp } from "@/types/navigation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { safeGoBack } from "@/navigation/safeGoBack";
import type { FrontLabelExtractionResult } from "@shared/types/front-label";

export default function ScanScreen() {
  const navigation = useNavigation<ScanScreenNavigationProp>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion, screenReaderEnabled } = useAccessibility();
  const { isPremium, remainingScans } = usePremiumCamera();
  const { refreshScanCount, features } = usePremiumContext();
  const queryClient = useQueryClient();

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const route = useRoute<RouteProp<RootStackParamList, "Scan">>();
  const returnAfterLog = route.params?.returnAfterLog ?? false;
  const isLabelMode = route.params?.mode === "label";
  // front-label uses FrontLabelConfirm AI flow — OCR frame processor not needed there
  const isFrontLabelMode = route.params?.mode === "front-label";
  const toast = useToast();

  const [scanPhase, dispatch] = useReducer(scanPhaseReducer, { type: "IDLE" });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [flashCount, setFlashCount] = useState(0);
  const [sonarVisible, setSonarVisible] = useState(false);
  const [sonarPos, setSonarPos] = useState(() => ({
    cx: screenWidth / 2,
    cy: screenHeight / 2,
  }));
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  // Visual pending state for the smart-photo confirm button. Mirrors
  // isConfirmingRef but is state so the chip's confirm button can re-render a
  // spinner while the async on-device OCR (menu path) runs. The ref still owns
  // the synchronous double-tap re-entrancy guard; this is purely the visual.
  const [isSmartConfirming, setIsSmartConfirming] = useState(false);

  const [confirmCard, setConfirmCard] = useState<ConfirmCardState | null>(null);
  // Premium-gate upsell for a blocked smart-confirm (menu/cook/receipt scan on a
  // free tier). Mirrors PhotoIntentScreen/ReceiptCaptureScreen — UpgradeModal has
  // no feature prop, so the copy is generic.
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const cameraRef = useRef<CameraRef>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barcodeAbsentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasLockedRef = useRef(false);
  const sessionNavigatedRef = useRef(false);
  const scanPhaseRef = useRef(scanPhase);
  // Render-time mirror (docs/rules/hooks.md): onBarcodeScanned reads this ref
  // synchronously at native-camera-frame cadence, so an effect-based mirror's
  // post-paint lag would replay a stale phase for a frame after every dispatch.
  scanPhaseRef.current = scanPhase;
  const reducedMotionRef = useRef(reducedMotion);
  const isCapturingRef = useRef(false);
  // Re-entrancy guard for onSmartPhotoConfirm: it is async (on-device OCR for
  // menus), which opens a double-tap window where two confirms could fire two
  // OCR runs + two navigations. Synchronous ref check, mirroring isCapturingRef.
  const isConfirmingRef = useRef(false);

  const { permission, requestPermission } = useCameraPermissions();

  // Keep reducedMotionRef current so onBarcodeScanned can read it without being in deps
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  // Dispatch CAMERA_READY when screen gains focus
  useEffect(() => {
    if (isFocused) {
      hasLockedRef.current = false;
      dispatch({ type: "CAMERA_READY" });
    }
  }, [isFocused]);

  // Reset when screen loses focus
  useEffect(() => {
    if (!isFocused) dispatch({ type: "RESET" });
  }, [isFocused]);

  // Coach hint escalation timer
  useEffect(() => {
    if (scanPhase.type === "HUNTING") {
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(
        () => setElapsedSeconds((s) => s + 1),
        1000,
      );
    } else {
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      setElapsedSeconds(0);
    }
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [scanPhase.type]);

  // Cleanup barcodeAbsentTimerRef on unmount
  useEffect(() => {
    return () => {
      if (barcodeAbsentTimerRef.current)
        clearTimeout(barcodeAbsentTimerRef.current);
    };
  }, []);

  // Navigate to NutritionDetail when session is complete — fire exactly once per session
  useEffect(() => {
    if (scanPhase.type !== "SESSION_COMPLETE") {
      sessionNavigatedRef.current = false;
      return;
    }
    if (sessionNavigatedRef.current) return;
    sessionNavigatedRef.current = true;

    if (!reducedMotion) {
      setShowConfetti(true);
    }

    const { barcode } = scanPhase;

    if (returnAfterLog) {
      setConfirmCard(buildLoadingConfirmCard(barcode));
      const controller = new AbortController();
      apiRequest("GET", `/api/nutrition/barcode/${barcode}`, undefined, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: { productName?: string; calories?: number }) => {
          setConfirmCard(buildLoadedConfirmCard(barcode, data));
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setConfirmCard(buildFetchErrorConfirmCard(barcode));
        });
      return () => controller.abort();
    }

    const timer = setTimeout(() => {
      void refreshScanCount();
      navigation.navigate("NutritionDetail", {
        barcode,
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [scanPhase, navigation, refreshScanCount, reducedMotion, returnAfterLog]);

  // Navigating away to edit (onEditStep2/onEditStep3) sets isFocused false,
  // which the existing "Reset when screen loses focus" effect above already
  // turns into a RESET → IDLE dispatch — that phase-type change is what
  // cancels this hook's pending timer (see useAutoAdvanceTimer's own cleanup),
  // so no extra cancellation logic is needed here.
  useAutoAdvanceTimer(scanPhase, screenReaderEnabled, dispatch);

  const handleConfirmLog = useCallback(async () => {
    if (!confirmCard || !canLog(confirmCard)) return;
    setConfirmCard((prev) => prev && { ...prev, isLogging: true });
    try {
      await apiRequest(
        "POST",
        "/api/scanned-items",
        buildScannedItemPayload(confirmCard),
      );
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      void refreshScanCount();
      toast.success(buildSuccessToastMessage(confirmCard));
      safeGoBack(navigation, () =>
        navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
      );
    } catch {
      setConfirmCard((prev) => prev && { ...prev, isLogging: false });
      toast.error("Failed to log item. Please try again.");
    }
  }, [confirmCard, navigation, toast, refreshScanCount, queryClient]);

  const handleConfirmDismiss = useCallback(() => {
    setConfirmCard(null);
    hasLockedRef.current = false;
    dispatch({ type: "CAMERA_READY" });
  }, []);

  // Announce loading state transitions to screen readers (iOS VoiceOver only —
  // Android TalkBack is handled by accessibilityLiveRegion on the loading view).
  const confirmIsLoading = confirmCard?.isLoading;
  const confirmIsError = confirmCard?.isError;
  const confirmName = confirmCard?.name;
  useEffect(() => {
    if (confirmIsLoading === undefined) return; // confirmCard is null
    if (Platform.OS !== "ios") return;
    if (confirmIsLoading) {
      AccessibilityInfo.announceForAccessibility("Identifying food");
    } else if (confirmIsError) {
      AccessibilityInfo.announceForAccessibility("Nutrition data unavailable");
    } else if (confirmName) {
      AccessibilityInfo.announceForAccessibility(confirmName);
    }
  }, [confirmIsLoading, confirmIsError, confirmName]);

  const fetchProductInfo = useCallback(async (barcode: string) => {
    try {
      const res = await apiRequest("GET", `/api/nutrition/barcode/${barcode}`);
      const data = await res.json();
      dispatch({
        type: "PRODUCT_LOADED",
        product: {
          name: data.productName ?? "Unknown product",
          brand: data.brandName ?? undefined,
          imageUri: data.imageUrl ?? undefined,
        },
      });
    } catch (err) {
      logger.error("[fetchProductInfo] product info fetch failed", err);
      // Non-critical — ProductChip renders without product data
    }
  }, []);

  const onBarcodeScanned = useCallback(
    (result: BarcodeResult) => {
      if (!isFocused || hasLockedRef.current) return;

      if (barcodeAbsentTimerRef.current) {
        clearTimeout(barcodeAbsentTimerRef.current);
        barcodeAbsentTimerRef.current = null;
      }

      const barcode = result.data;
      const bounds = result.bounds ?? {
        x: 0.3,
        y: 0.4,
        width: 0.4,
        height: 0.2,
      };

      // Read from the ref, not the closed-over `scanPhase` — this callback can
      // still be attached to the native camera output for a frame or two after
      // a dispatch, before React re-renders and re-attaches the latest closure.
      // Reading `scanPhase` directly would replay that stale frameCount forever
      // (see docs/solutions for the same fix on onShutterPress/scanPhaseRef).
      const currentPhase = scanPhaseRef.current;
      if (
        currentPhase.type !== "HUNTING" &&
        currentPhase.type !== "BARCODE_TRACKING"
      ) {
        return;
      }

      const tracking: BarcodeTrackingState =
        currentPhase.type === "BARCODE_TRACKING"
          ? {
              status: "tracking",
              barcode: currentPhase.barcode,
              frameCount: currentPhase.frameCount,
            }
          : { status: "idle" };

      const decision = evaluateBarcodeDetection(tracking, barcode);

      if (decision.action === "start") {
        dispatch({ type: "FIRST_BARCODE_DETECTED", barcode, bounds });
        return;
      }

      dispatch({ type: "BARCODE_UPDATED", bounds });

      if (decision.action === "lock") {
        hasLockedRef.current = true;
        haptics.notification(Haptics.NotificationFeedbackType.Success);
        if (!reducedMotionRef.current) {
          setFlashCount((c) => c + 1);
          setSonarPos({
            cx: (bounds.x + bounds.width / 2) * screenWidth,
            cy: (bounds.y + bounds.height / 2) * screenHeight,
          });
          setSonarVisible(true);
        }
        dispatch({ type: "BARCODE_LOCKED" });
        void fetchProductInfo(barcode);
        return;
      }

      barcodeAbsentTimerRef.current = setTimeout(() => {
        dispatch({ type: "BARCODE_LOST" });
      }, 800);
    },
    [isFocused, screenWidth, screenHeight, fetchProductInfo, haptics],
  );

  const onShutterPress = useCallback(async () => {
    const phase = scanPhaseRef.current;
    if (
      phase.type !== "BARCODE_LOCKED" &&
      phase.type !== "STEP2_CONFIRMED" &&
      phase.type !== "HUNTING"
    )
      return;

    // Guard against duplicate captures from rapid taps — ref check is synchronous
    // and avoids the re-render cycle that makes `disabled` lag behind fast input.
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;

    try {
      if (phase.type === "HUNTING") {
        const photo = await cameraRef.current?.takePicture();
        if (!photo) {
          Alert.alert("Capture failed", "Please try again.");
          return;
        }
        haptics.impact(Haptics.ImpactFeedbackStyle.Medium);

        // Label mode: skip smart classification, go directly to LabelAnalysis.
        // On-device snapshot OCR pre-fills an instant preview; the server does the
        // authoritative analysis, so OCR failure here is non-fatal (preview absent).
        if (isLabelMode) {
          let localOCRText: string | undefined;
          try {
            const ocrResult = await recognizeTextFromPhoto(photo.uri);
            localOCRText = ocrResult.text || undefined;
          } catch (err) {
            logger.error(
              "[ScanScreen label OCR] recognition failed; navigating without preview",
              err,
            );
          }
          navigation.navigate("LabelAnalysis", {
            imageUri: photo.uri,
            localOCRText,
          });
          return;
        }

        dispatch({ type: "SMART_PHOTO_INITIATED", imageUri: photo.uri });
        try {
          const result = await uploadPhotoForAnalysis(photo.uri, "auto");
          dispatch({
            type: "CLASSIFICATION_SUCCEEDED",
            classification: result,
          });
          haptics.notification(
            getConfidenceHapticType(
              getConfidenceTier(result.overallConfidence),
            ),
          );
        } catch (err) {
          // Stale dispatch is safe — reducer no-ops CLASSIFICATION_FAILED when state !== CLASSIFYING
          dispatch({
            type: "CLASSIFICATION_FAILED",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
        return;
      }

      const photo = await cameraRef.current?.takePicture();
      if (!photo) {
        Alert.alert("Capture failed", "Please try again.");
        return;
      }

      // Haptic + flash immediately after capture, before async OCR
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      setFlashCount((c) => c + 1);

      if (phase.type === "BARCODE_LOCKED") {
        let ocrText = "";
        try {
          const ocrResult = await recognizeTextFromPhoto(photo.uri);
          ocrText = ocrResult.text ?? "";
        } catch (err) {
          // OCR failure is non-fatal: the STEP2 photo is still captured and the
          // session proceeds. We fall back to empty text intentionally — the
          // reducer stores it, and no downstream screen requires the OCR result
          // (NutritionDetail does its own lookup). Log via logger.error so the
          // failure is visible in production logs (routed to the reporter), not
          // silently swallowed — logger.warn is dev-only and would hide it.
          logger.error(
            "[ScanScreen STEP2 OCR] recognition failed; proceeding with empty text",
            err,
          );
        }
        dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photo.uri, ocrText });
      } else {
        // STEP2_CONFIRMED (front-label capture) — no OCR needed
        dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photo.uri });
      }
    } finally {
      isCapturingRef.current = false;
    }
  }, [isLabelMode, navigation, haptics]);

  // Permission screens
  if (!permission || permission.status === "undetermined") {
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
          onPress={requestPermission}
          accessibilityLabel="Allow camera access"
          accessibilityRole="button"
        >
          <Text style={styles.permissionBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (permission.status === "denied") {
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
          onPress={() =>
            safeGoBack(navigation, () =>
              navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
            )
          }
          accessibilityLabel="Cancel and go back"
          accessibilityRole="button"
        >
          <Text
            style={[
              styles.permissionCancelText,
              { color: theme.textSecondary },
            ]}
          >
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const coachMessage = getCoachMessage(scanPhase, elapsedSeconds);

  // Android TalkBack focus trap for the overlays (no-op on iOS). The static
  // camera UI and ProductChip need different values — see getScanOverlayA11y.
  const productChipVisible = getProductChipVariant(scanPhase) !== null;
  const overlayA11y = getScanOverlayA11y(!!confirmCard, productChipVisible);

  const shutterArmed =
    scanPhase.type === "HUNTING" ||
    scanPhase.type === "BARCODE_LOCKED" ||
    scanPhase.type === "STEP2_CONFIRMED";

  return (
    <View style={styles.root} accessibilityViewIsModal>
      <CameraView
        ref={cameraRef}
        barcodeTypes={
          isLabelMode || isFrontLabelMode
            ? []
            : ["ean13", "ean8", "upc_e", "code128", "code39", "qr"]
        }
        onBarcodeScanned={
          isLabelMode || isFrontLabelMode ? undefined : onBarcodeScanned
        }
        enableTorch={torchEnabled}
        isActive={isFocused && !confirmCard}
      />

      <ScanReticle phase={scanPhase} reducedMotion={reducedMotion} />

      {sonarVisible && (
        <ScanSonarRing
          cx={sonarPos.cx}
          cy={sonarPos.cy}
          onComplete={() => setSonarVisible(false)}
        />
      )}

      <ScanFlashOverlay triggerCount={flashCount} />

      {/* Top overlay */}
      <View
        style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}
        importantForAccessibility={overlayA11y.staticUI}
      >
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() =>
            safeGoBack(navigation, () =>
              navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
            )
          }
          accessibilityLabel="Close camera"
          accessibilityRole="button"
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <StepPill phase={scanPhase} />
        {!isPremium && remainingScans !== null && (
          <Text style={styles.scanCountText}>
            {remainingScans > 0
              ? `${remainingScans} scans remaining`
              : "Daily limit reached"}
          </Text>
        )}
      </View>

      {/* Coach hint */}
      <View
        style={styles.coachContainer}
        importantForAccessibility={overlayA11y.staticUI}
      >
        <CoachHint message={coachMessage} />
      </View>

      {/* Bottom controls */}
      <View
        style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}
        importantForAccessibility={overlayA11y.staticUI}
      >
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setTorchEnabled((t) => !t)}
          accessibilityLabel={
            torchEnabled ? "Turn off flashlight" : "Turn on flashlight"
          }
          accessibilityRole="button"
          accessibilityState={{ checked: torchEnabled }}
        >
          <Text style={styles.iconBtnText}>{torchEnabled ? "⚡" : "🔦"}</Text>
        </TouchableOpacity>
        <Pressable
          style={[styles.shutter, shutterArmed && styles.shutterArmed]}
          onPress={onShutterPress}
          accessibilityLabel="Take photo"
          accessibilityRole="button"
        />
        <View style={styles.iconBtn} />
      </View>

      {showConfetti && (
        <ConfettiCannon
          count={30}
          origin={{ x: screenWidth / 2, y: 0 }}
          autoStart
          fadeOut
          fallSpeed={2500}
          colors={["#22c55e", "#f59e0b", "#FFFFFF", "#60a5fa"]} // hardcoded — confetti palette, not theme-able
          onAnimationEnd={() => setShowConfetti(false)}
        />
      )}

      {/* Product chip */}
      <ProductChip
        importantForAccessibility={overlayA11y.productChip}
        isSmartConfirming={isSmartConfirming}
        screenReaderEnabled={screenReaderEnabled}
        phase={scanPhase}
        onConfirm={() => dispatch({ type: "CONFIRM_PRODUCT" })}
        onStepConfirmed={() => dispatch({ type: "STEP_CONFIRMED" })}
        onEditStep2={() => {
          if (
            scanPhase.type === "STEP2_REVIEWING" ||
            scanPhase.type === "STEP2_CONFIRMED"
          ) {
            const imageUri =
              scanPhase.type === "STEP2_REVIEWING"
                ? scanPhase.imageUri
                : scanPhase.nutritionImageUri;
            navigation.navigate("LabelAnalysis", { imageUri });
          }
        }}
        onEditStep3={() => {
          if (scanPhase.type === "STEP3_REVIEWING") {
            const emptyFrontLabel: FrontLabelExtractionResult = {
              brand: null,
              productName: null,
              netWeight: null,
              claims: [],
              confidence: 0,
            };
            navigation.navigate("FrontLabelConfirm", {
              imageUri: scanPhase.frontImageUri,
              barcode: scanPhase.barcode,
              sessionId: null,
              data: emptyFrontLabel,
            });
          }
        }}
        onSmartPhotoConfirm={async () => {
          if (scanPhase.type !== "SMART_CONFIRMED") return;
          if (isConfirmingRef.current) return;
          isConfirmingRef.current = true;
          setIsSmartConfirming(true);
          try {
            const { classification, imageUri } = scanPhase;
            const action = await resolveSmartConfirmAction({
              classification,
              imageUri,
              features,
              recognizeText: recognizeTextFromPhoto,
              // Liveness across the OCR await: navigation.isFocused() is real-time
              // (not subject to React state-mirror timing); paired with the phase
              // ref it bails if the user left the scan screen during recognition.
              isStillLive: () =>
                navigation.isFocused() &&
                scanPhaseRef.current.type === "SMART_CONFIRMED",
            });
            switch (action.kind) {
              case "navigate":
                // navigate accepts a variable screen name from a discriminated union;
                // cast the whole function signature to avoid React Navigation's strict
                // per-screen overloads while keeping params typed via ClassificationRoute.
                (
                  navigation.navigate as (
                    screen: string,
                    params?: Record<string, unknown>,
                  ) => void
                )(
                  action.route.screen,
                  action.route.params as Record<string, unknown> | undefined,
                );
                break;
              case "blocked":
                // blocked: hide the chip (RESET) and show the upsell. RESET-on-block
                // (not on modal close) avoids leaving a stale interactive confirm chip
                // in the a11y tree behind the modal. Focus-trap safety itself does not
                // hinge on ordering — UpgradeModal is a RN <Modal> in its own native
                // window, so its trap never nests with the chip's accessibilityViewIsModal
                // (which lingers through its spring-out). The camera sits at IDLE behind.
                dispatch({ type: "RESET" });
                setShowUpgradeModal(true);
                break;
              case "unrecognized":
                // Surface the existing SMART_ERROR chip ("Couldn't identify this. Try
                // again?") — visible and announced on both platforms — instead of a
                // silent reset.
                dispatch({ type: "SMART_CONFIRM_FAILED" });
                break;
              case "abort":
                // user left during OCR — do nothing.
                break;
              default: {
                // Exhaustiveness guard: a new SmartConfirmAction kind must be handled
                // here — a silent no-op is exactly the bug this change fixes.
                const _exhaustive: never = action;
                throw new Error(
                  `unhandled smart-confirm action: ${String(_exhaustive)}`,
                );
              }
            }
          } finally {
            isConfirmingRef.current = false;
            setIsSmartConfirming(false);
          }
        }}
        onRetry={() => dispatch({ type: "RESET" })}
      />

      {confirmCard && (
        <View
          style={[
            styles.confirmOverlay,
            {
              backgroundColor: withOpacity(theme.backgroundRoot, 0.95),
              paddingBottom: insets.bottom + Spacing.lg,
            },
          ]}
          accessibilityViewIsModal
        >
          {confirmCard.isLoading ? (
            <View
              style={styles.confirmLoadingRow}
              accessibilityLiveRegion="polite"
            >
              <ActivityIndicator color={theme.link} />
              <ThemedText
                style={{ color: theme.textSecondary, marginLeft: Spacing.sm }}
              >
                Identifying food…
              </ThemedText>
            </View>
          ) : (
            <View
              style={[
                styles.confirmCard,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.confirmInfo}>
                {confirmCard.isError ? (
                  <>
                    <ThemedText
                      type="body"
                      style={{
                        color: theme.textSecondary,
                        fontFamily: FontFamily.semiBold,
                      }}
                      accessibilityLiveRegion="polite"
                    >
                      Nutrition data unavailable
                    </ThemedText>
                    <ThemedText
                      style={{ color: theme.textSecondary, fontSize: 12 }}
                    >
                      Barcode: {confirmCard.barcode}
                    </ThemedText>
                  </>
                ) : (
                  <ThemedText
                    type="body"
                    style={{
                      color: theme.text,
                      fontFamily: FontFamily.semiBold,
                    }}
                    numberOfLines={2}
                    accessibilityLiveRegion="polite"
                  >
                    {confirmCard.name}
                  </ThemedText>
                )}
                {!confirmCard.isError && confirmCard.calories !== null && (
                  <ThemedText style={{ color: theme.link, fontSize: 14 }}>
                    {confirmCard.calories} cal
                  </ThemedText>
                )}
              </View>
              <View style={styles.confirmButtons}>
                <Pressable
                  onPress={handleConfirmDismiss}
                  disabled={confirmCard.isLogging}
                  style={({ pressed }) => [
                    styles.confirmDismissButton,
                    {
                      borderColor: theme.border,
                      opacity: pressed || confirmCard.isLogging ? 0.5 : 1,
                    },
                  ]}
                  accessibilityLabel="Dismiss"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: confirmCard.isLogging }}
                >
                  <ThemedText
                    style={{ color: theme.textSecondary, fontSize: 14 }}
                  >
                    Dismiss
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleConfirmLog}
                  disabled={!canLog(confirmCard)}
                  style={({ pressed }) => [
                    styles.confirmLogButton,
                    {
                      backgroundColor: confirmCard.isError
                        ? withOpacity(theme.link, 0.4)
                        : theme.accentSolid,
                      opacity: pressed || confirmCard.isLogging ? 0.7 : 1,
                    },
                  ]}
                  accessibilityLabel={
                    confirmCard.isError
                      ? "Log It (unavailable — nutrition data missing)"
                      : "Log It"
                  }
                  accessibilityRole="button"
                  accessibilityState={{
                    busy: confirmCard.isLogging,
                    disabled: confirmCard.isError,
                  }}
                >
                  {confirmCard.isLogging ? (
                    <ActivityIndicator size="small" color={theme.buttonText} />
                  ) : (
                    <ThemedText
                      style={{
                        color: theme.buttonText,
                        fontSize: 14,
                        fontFamily: FontFamily.medium,
                      }}
                    >
                      ✓ Log It
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" }, // hardcoded — camera background must always be black
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
    gap: 12,
  },
  closeBtn: {
    alignSelf: "flex-end",
    marginRight: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#FFF", fontSize: 14, fontWeight: "600" }, // hardcoded — camera overlay
  coachContainer: {
    position: "absolute",
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    zIndex: 10,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnText: { fontSize: 18 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FFF", // hardcoded — camera overlay
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.4)",
  },
  shutterArmed: {
    borderColor: "#FFD60A", // hardcoded — matches FocusRing's focus-ring yellow (Task 6)
    shadowColor: "#FFD60A", // hardcoded — same focus-ring yellow, for the shadow glow
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
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
  scanCountText: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  confirmOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  confirmLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  confirmCard: {
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  confirmInfo: {
    gap: 4,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  confirmDismissButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.xs,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  confirmLogButton: {
    flex: 2,
    borderRadius: BorderRadius.xs,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
});
