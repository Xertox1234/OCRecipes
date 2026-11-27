import React, {
  useCallback,
  useEffect,
  useMemo,
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
  useWindowDimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { deleteAsync } from "expo-file-system/legacy";
import { Feather } from "@expo/vector-icons";
import {
  useNavigation,
  useIsFocused,
  useRoute,
} from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
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
import type { ScanAction, ScanPhase } from "@/camera/types/scan-phase";
import { CoachHint } from "@/camera/components/CoachHint";
import { ScanReticle } from "@/camera/components/ScanReticle";
import {
  LOOKUP_ERROR_TEXT,
  ProductChip,
  type LookupErrorKind,
} from "@/camera/components/ProductChip";
import { getProductChipVariant } from "@/camera/components/ProductChip-utils";
import { ScanFlashOverlay } from "@/camera/components/ScanFlashOverlay";
import { ScanSonarRing } from "@/camera/components/ScanSonarRing";
import { getFlowCoachMessage } from "@/camera/components/CoachHint-utils";
import { CameraShell } from "@/camera/shell/CameraShell";
import { StepTabs } from "@/camera/shell/StepTabs";
import { ExampleCard, EXAMPLE_CONTENT } from "@/camera/shell/ExampleCard";
import { HelpSheet } from "@/camera/shell/HelpSheet";
import { TipsCarousel } from "@/camera/shell/TipsCarousel";
import { ManualBarcodeSheet } from "@/camera/shell/ManualBarcodeSheet";
import {
  getBarcodeFlowView,
  getPhotosDiscardedByCommit,
  type FlowView,
} from "@/camera/shell/barcode-flow";
import { useScanOnboarding } from "@/camera/shell/useScanOnboarding";
import type { ScanExampleKey } from "@/lib/feature-tips-storage";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { invalidateFoodLogQueries } from "@/lib/food-log-invalidation";
import { logger } from "@/lib/logger";
import { uploadPhotoForAnalysis } from "@/lib/photo-upload";
import { isScanIntent, isScanIntentLocked } from "@/screens/photo-intent-utils";
import {
  resolveSmartConfirmAction,
  resolveMenuLocalOCRText,
  getRouteForPickedIntent,
  evaluateBarcodeDetection,
  buildProductSummary,
  buildNutritionDetailParams,
  getCapturePlan,
  getShutterBlockedReason,
  getScanFlow,
  getGenericFlowView,
  type BarcodeTrackingState,
  type CaptureMode,
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
} from "@/components/scan/ScanScreenConfirmOverlay-utils";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ScanConfirmOverlay } from "@/components/scan/ScanConfirmOverlay";
import { CameraPermissionGate } from "@/components/scan/CameraPermissionGate";
import { useToast } from "@/context/ToastContext";
import { announceTogether } from "@/lib/announce-together";
import { CameraColors, FontFamily } from "@/constants/theme";
import type { ScanScreenNavigationProp } from "@/types/navigation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { safeGoBack } from "@/navigation/safeGoBack";
import type { FrontLabelExtractionResult } from "@shared/types/front-label";
import { parseFrontLabelFromOCR } from "@/lib/front-label-ocr-parser";
import { pickTopSafetyFlag } from "@shared/types/scan-flags";
import type { ScanFlag } from "@shared/types/scan-flags";
import { useMarkFeatureUsed } from "@/hooks/useFeatureTip";

const TORCH_ICON_COLOR = "#FFFFFF"; // hardcoded — camera overlay

const PHOTOS_CLEARED_NOTICE = "New product: earlier photos cleared";
const NOT_IN_DATABASE_TEXT =
  "We don't know this one yet. The label and front photos will fill it in";

// The help sheet's step title / example card for each step tab.
const TAB_EXAMPLE: Record<FlowView["tabs"][number]["id"], ScanExampleKey> = {
  barcode: "barcode",
  nutrition: "barcode-nutrition",
  front: "barcode-front",
};

/** The example card for the step in progress ("?" and its sheet title). */
function getStepExampleKey(view: FlowView): ScanExampleKey {
  const active = view.tabs.find((tab) => tab.state === "active");
  return active ? TAB_EXAMPLE[active.id] : (view.exampleKey ?? "barcode");
}

/** Phases where a barcode the camera reads (or one typed in) can lock. */
function acceptsBarcode(phase: ScanPhase): boolean {
  return phase.type === "HUNTING" || phase.type === "BARCODE_TRACKING";
}

// FrontLabelConfirm's seed when there is no on-device read of the package
// front; the screen runs the AI extraction itself when sessionId is null.
const EMPTY_FRONT_LABEL: FrontLabelExtractionResult = {
  brand: null,
  productName: null,
  netWeight: null,
  claims: [],
  confidence: 0,
};

export default function ScanScreen() {
  // Opening this screen counts as using the feature, so its tips stop.
  useMarkFeatureUsed("scan");
  const navigation = useNavigation<ScanScreenNavigationProp>();
  const isFocused = useIsFocused();
  const haptics = useHaptics();
  const { reducedMotion, screenReaderEnabled } = useAccessibility();
  const { isPremium, remainingScans } = usePremiumCamera();
  // The scan-count pill is plain text; speak the limit once, on the edge
  // from scans-left to none (silent when the camera opens already at it).
  const prevRemainingScansRef = useRef(remainingScans);
  useEffect(() => {
    const prev = prevRemainingScansRef.current;
    prevRemainingScansRef.current = remainingScans;
    if (!isPremium && prev !== null && prev > 0 && remainingScans === 0) {
      AccessibilityInfo.announceForAccessibility("Daily scan limit reached");
    }
  }, [isPremium, remainingScans]);
  const { refreshScanCount, features, canGenerateRecipe } = usePremiumContext();
  const queryClient = useQueryClient();

  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const route = useRoute<RouteProp<RootStackParamList, "Scan">>();
  const returnAfterLog = route.params?.returnAfterLog ?? false;
  const isLabelMode = route.params?.mode === "label";
  // front-label uses FrontLabelConfirm AI flow — OCR frame processor not needed there
  const isFrontLabelMode = route.params?.mode === "front-label";
  const isSmartMode = route.params?.mode === "smart";
  const verifyBarcode = route.params?.verifyBarcode;
  // Photo intent picked on PhotoIntent before capture. Untrusted at runtime
  // (CoachChat casts model params to this screen's type): anything that is not
  // a known intent is ignored and the photo is auto-classified as before.
  // `mode` wins when both are present (its branch runs first).
  const rawIntent: unknown = route.params?.intent;
  const pickedIntent = isScanIntent(rawIntent) ? rawIntent : undefined;
  // No mode and no intent: the guided Barcode · Nutrition · Front flow.
  // Otherwise the generic one-photo flow (title pill, one frame, shutter).
  const isBarcodeFlow = getScanFlow(route.params) === "barcode";
  // Raw presence, the same test getScanFlow uses, so an unknown intent's
  // generic flow keeps a live shutter.
  const hasIntent = rawIntent !== undefined;
  // ONE capture mode for every getCapturePlan / getShutterBlockedReason call:
  // the press guard and the armed visual must never disagree.
  const captureMode = useMemo<CaptureMode>(
    () => ({
      isFrontLabelMode,
      isLabelMode,
      hasVerifyBarcode: !!verifyBarcode,
      hasIntent,
      isSmartMode,
    }),
    [isFrontLabelMode, isLabelMode, verifyBarcode, hasIntent, isSmartMode],
  );
  const toast = useToast();
  // Read through a ref inside the stable dispatch wrapper below, which must
  // not change identity when the toast context value does.
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [scanPhase, rawDispatch] = useReducer(scanPhaseReducer, {
    type: "IDLE",
  });
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
  // The barcode whose lookup came back 404. Compared with the CURRENT lock at
  // render, so a slow 404 for an earlier barcode never marks a newer lock.
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
  // A failed (non-404) lookup, keyed the same way: offline or a server error.
  const [lookupError, setLookupError] = useState<{
    barcode: string;
    kind: LookupErrorKind;
  } | null>(null);
  const [helpVisible, setHelpVisible] = useState(false);
  const [manualVisible, setManualVisible] = useState(false);
  // True while the carousel, an example card or a sheet covers the camera:
  // a barcode must not lock unseen behind it. A ref, because the native
  // camera keeps calling the barcode callback it attached first.
  const scanPausedRef = useRef(false);

  const cameraRef = useRef<CameraRef>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barcodeAbsentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasLockedRef = useRef(false);
  const sessionNavigatedRef = useRef(false);
  const scanPhaseRef = useRef(scanPhase);
  // Temp capture files (capturePhotoToFile writes to the OS temp dir) that
  // this screen currently owns and nothing has cleaned up yet. Captures that
  // are handed to another screen (front-label/label-mode navigate, or the
  // trackTempUri callers below releasing before their own navigate) are
  // removed here without deleting — ownership just transferred. Anything
  // still present when the scan is abandoned (reset or unmount) is deleted.
  // nutritionImageUri/frontImageUri displayed by NutritionDetail are released
  // right before that navigate fires — see the SESSION_COMPLETE effect below.
  const pendingTempUrisRef = useRef<Set<string>>(new Set());
  const trackTempUri = useCallback((uri: string) => {
    pendingTempUrisRef.current.add(uri);
  }, []);
  const releaseTempUri = useCallback((uri: string | undefined) => {
    if (uri) pendingTempUrisRef.current.delete(uri);
  }, []);
  // A photo the user retook: delete it now rather than at abandon.
  const discardTempUri = useCallback((uri: string) => {
    pendingTempUrisRef.current.delete(uri);
    deleteAsync(uri, { idempotent: true }).catch(() => {});
  }, []);
  const cleanupPendingUris = useCallback(() => {
    pendingTempUrisRef.current.forEach((uri) => {
      deleteAsync(uri, { idempotent: true }).catch(() => {});
    });
    pendingTempUrisRef.current.clear();
  }, []);
  // Dispatch wrapper (docs/rules/hooks.md "wrap the setter"): onBarcodeScanned
  // reads scanPhaseRef synchronously at native-camera-frame cadence, so the ref
  // must advance at dispatch time — neither an effect mirror (post-paint lag)
  // nor a render-body write (opts the component out of React Compiler) works.
  // It relies on scanPhaseReducer staying pure: the reducer runs here and again
  // inside React, and both must agree.
  //
  // It also owns the one cross-phase clean-up: after a redo-barcode detour
  // locks a DIFFERENT product, committing to it (any forward action off its
  // found card) drops the photos carried for the old one, so their temp
  // files are deleted here and the user is told (Review Focus 1). "Not this"
  // keeps them. Every phase change goes through this wrapper, which is why
  // the check lives here rather than in an effect.
  const dispatch = useCallback(
    (action: ScanAction) => {
      const prev = scanPhaseRef.current;
      const next = scanPhaseReducer(prev, action);
      scanPhaseRef.current = next;
      rawDispatch(action);
      const dropped = getPhotosDiscardedByCommit(prev, next);
      if (dropped.length > 0) {
        dropped.forEach((uri) => discardTempUri(uri));
        toastRef.current.info(PHOTOS_CLEARED_NOTICE);
      }
    },
    [discardTempUri],
  );
  const reducedMotionRef = useRef(reducedMotion);
  const isCapturingRef = useRef(false);
  // Re-entrancy guard for onSmartPhotoConfirm: it is async (on-device OCR for
  // menus), which opens a double-tap window where two confirms could fire two
  // OCR runs + two navigations. Synchronous ref check, mirroring isCapturingRef.
  const isConfirmingRef = useRef(false);

  // Every abandonment of the scan session (blur, an explicit retry, or a
  // premium-blocked smart confirm) must clean up before discarding scanPhase
  // — dispatch(RESET) alone silently drops whatever imageUri that phase held.
  const resetScan = useCallback(() => {
    cleanupPendingUris();
    dispatch({ type: "RESET" });
  }, [cleanupPendingUris, dispatch]);
  // RESET parks the phase at IDLE, and only CAMERA_READY leaves it (the focus
  // effect below). A reset that keeps the user on Scan ("Try again", closing
  // the upsell) must re-arm, or barcodes and the shutter stay dead until the
  // screen is reopened. navigation.isFocused() reads focus live, so a call
  // that lands after the user left stays at IDLE.
  const rearmScan = useCallback(() => {
    resetScan();
    if (navigation.isFocused()) {
      hasLockedRef.current = false;
      dispatch({ type: "CAMERA_READY" });
    }
  }, [resetScan, navigation, dispatch]);
  // Backstop for the case ScanScreen unmounts (the scan modal dismissed)
  // without the blur effect below running first. Idempotent: cleanupPendingUris
  // clears the set after running, and deleteAsync is idempotent itself.
  useEffect(() => cleanupPendingUris, [cleanupPendingUris]);

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
  }, [isFocused, dispatch]);

  // Reset when screen loses focus — also cleans up any temp capture file the
  // abandoned phase was holding (resetScan; see pendingTempUrisRef above).
  useEffect(() => {
    if (!isFocused) resetScan();
  }, [isFocused, resetScan]);

  // What the camera shell shows for this phase: the guided flow's step view,
  // or the generic flow's single frame + shutter.
  const view: FlowView & { title?: string } = isBarcodeFlow
    ? getBarcodeFlowView(scanPhase, { returnAfterLog })
    : getGenericFlowView(route.params);

  const onboarding = useScanOnboarding({
    exampleKey: view.exampleKey,
    examplesEnabled: isBarcodeFlow,
  });
  const { exampleCardKey } = onboarding;
  // A teaching surface (carousel / example card) covers the camera.
  const teachingUp = onboarding.carouselVisible || exampleCardKey !== null;
  // Anything covering the camera: no barcode may lock unseen behind it, and
  // the hint escalation clock waits.
  const scanPaused = teachingUp || helpVisible || manualVisible;

  // Effect, not a render write (React Compiler): read only by the barcode
  // callback, a frame later at the earliest.
  useEffect(() => {
    scanPausedRef.current = scanPaused;
  }, [scanPaused]);

  // Coach hint escalation timer
  // Held at 0 while something covers the camera, so a first-time user who
  // reads the carousel and card lands on the step hint, not an escalation.
  useEffect(() => {
    if (scanPhase.type === "HUNTING" && !scanPaused) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- camera coach-hint timer: the reset stays with the interval it restarts on each HUNTING entry (and with its clear on leaving), kept as one effect rather than restructuring camera lifecycle
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
  }, [scanPhase.type, scanPaused]);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- once-per-session SESSION_COMPLETE orchestration (confetti, barcode fetch, navigation) guarded by a ref; it starts external work, so it cannot run during render
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
        .then(
          (data: {
            productName?: string;
            calories?: number;
            flags?: ScanFlag[];
          }) => {
            const card = buildLoadedConfirmCard(barcode, data);
            setConfirmCard(card);
            // Raise salience on a severe flag WITHOUT blocking the flow (badges
            // only) — mirrors fetchProductInfo's ProductChip-path haptic below,
            // since this path never opens NutritionDetail to carry it instead.
            // tier check required: topDisplayFlag can hold a nutrition flag,
            // and the Warning haptic is reserved for safety-tier danger.
            if (
              card.topDisplayFlag?.tier === "safety" &&
              card.topDisplayFlag.severity === "danger"
            ) {
              haptics.notification(Haptics.NotificationFeedbackType.Warning);
            }
          },
        )
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setConfirmCard(buildFetchErrorConfirmCard(barcode));
        });
      return () => controller.abort();
    }

    const timer = setTimeout(() => {
      void refreshScanCount();
      // Ownership of the wizard's captured photos transfers to NutritionDetail
      // here — release before navigating so the abandon-cleanup above never
      // deletes a file NutritionDetail is about to display (Scope Contract Risk).
      // Both fields are optional (undefined on a barcode-only session);
      // releaseTempUri no-ops on undefined.
      releaseTempUri(scanPhase.nutritionImageUri);
      releaseTempUri(scanPhase.frontImageUri);
      navigation.navigate(
        "NutritionDetail",
        buildNutritionDetailParams(scanPhase),
      );
    }, 700);
    return () => clearTimeout(timer);
  }, [
    scanPhase,
    navigation,
    refreshScanCount,
    reducedMotion,
    returnAfterLog,
    releaseTempUri,
    // `haptics` is useMemo-stable (client/hooks/useHaptics.ts keys it on
    // [impact, notification, selection, reducedMotion], each useCallback'd on
    // [reducedMotion]), so it changes identity only when `reducedMotion`
    // (already a dep above) does. Listing the whole object therefore cannot
    // re-run this effect — and abort the in-flight returnAfterLog fetch via
    // the cleanup's controller.abort() — on an unrelated ScanScreen re-render.
    haptics,
  ]);

  // A Retake (RETAKE_STEP) or a blur reset changes the phase type, which is
  // what cancels this hook's pending timer (see useAutoAdvanceTimer's own
  // cleanup), so no extra cancellation logic is needed here.
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
      invalidateFoodLogQueries(queryClient);
      void refreshScanCount();
      toast.success(buildSuccessToastMessage(confirmCard));
      safeGoBack(navigation, () =>
        navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
      );
    } catch (err) {
      setConfirmCard((prev) => prev && { ...prev, isLogging: false });
      toast.error(
        err instanceof ApiError && err.code === ErrorCode.RATE_LIMITED
          ? "Too many requests. Please wait a moment and try again."
          : "Failed to log item. Please try again.",
      );
    }
  }, [confirmCard, navigation, toast, refreshScanCount, queryClient]);

  const handleConfirmDismiss = useCallback(() => {
    setConfirmCard(null);
    hasLockedRef.current = false;
    dispatch({ type: "CAMERA_READY" });
  }, [dispatch]);

  const goBackOrMain = useCallback(() => {
    safeGoBack(navigation, () =>
      navigation.reset({ index: 0, routes: [{ name: "Main" }] }),
    );
  }, [navigation]);

  const fetchProductInfo = useCallback(
    async (barcode: string) => {
      // Body hoisted into an inner function: React Compiler cannot lower value
      // blocks (`?.`, `&&`, ternaries) inside a try/catch.
      // A new lookup starts clean: the card goes back to its skeleton until
      // this answer lands (an earlier error or 404 for the same barcode must
      // not hide a later success).
      setLookupError((prev) => (prev?.barcode === barcode ? null : prev));
      setNotFoundBarcode((prev) => (prev === barcode ? null : prev));
      const loadProduct = async () => {
        const res = await apiRequest(
          "GET",
          `/api/nutrition/barcode/${barcode}`,
        );
        const data = await res.json();
        const flags = Array.isArray(data.flags) ? data.flags : [];
        // safetyFlag: tier==="safety"-only (Phase-1 fail-dangerous allergen
        // semantics) — this LOCAL variable drives the haptic below,
        // unchanged; the field of the same name on the dispatched product is
        // kept for its safety-tier-only semantics but has no reader today.
        // The dispatched product's `topFlag` uses the shared
        // `pickTopDisplayFlag` composition (top safety-tier flag if ANY
        // safety flag is present, else the top warn/danger-level non-safety
        // flag) via `buildProductSummary` — see its doc comment in
        // shared/types/scan-flags.ts. The returnAfterLog confirm-card
        // overlay (ScanScreenConfirmOverlay-utils.ts) must use the SAME
        // helper, not re-derive this inline — a prior refactor updated only
        // this call site and produced a parity gap between the two surfaces.
        const safetyFlag = pickTopSafetyFlag(flags);
        dispatch({
          type: "PRODUCT_LOADED",
          barcode,
          product: buildProductSummary(data, flags),
        });
        // Raise salience on a severe flag WITHOUT blocking the flow (badges only).
        // In returnAfterLog mode the confirm-card branch above owns this haptic
        // for the same barcode — skip here to avoid a double buzz. Also gated
        // on liveness: this fires after an async await, and `isFocused` state
        // would be a stale closure here — navigation.isFocused() reads it live
        // (same liveness check onSmartPhotoConfirm uses below), so a user who
        // left Scan while this fetch was in flight doesn't get buzzed after
        // the fact.
        if (
          safetyFlag?.severity === "danger" &&
          !returnAfterLog &&
          navigation.isFocused()
        ) {
          haptics.notification(Haptics.NotificationFeedbackType.Warning);
        }
      };
      try {
        await loadProduct();
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // Not in the database: the found card says so instead of a
          // skeleton forever. Spoken only while this barcode is still the
          // lock on screen (a slow reply may land after "Not this").
          setNotFoundBarcode(barcode);
          const current = scanPhaseRef.current;
          if (
            navigation.isFocused() &&
            current.type === "BARCODE_LOCKED" &&
            current.barcode === barcode
          ) {
            AccessibilityInfo.announceForAccessibility(NOT_IN_DATABASE_TEXT);
          }
          return;
        }
        logger.error("[fetchProductInfo] product info fetch failed", err);
        // The found card says what failed and offers Try again / Type it
        // in. A thrown non-ApiError TypeError is fetch's network failure.
        const kind: LookupErrorKind =
          !(err instanceof ApiError) && err instanceof TypeError
            ? "offline"
            : "failed";
        setLookupError({ barcode, kind });
        const live = scanPhaseRef.current;
        if (
          navigation.isFocused() &&
          live.type === "BARCODE_LOCKED" &&
          live.barcode === barcode
        ) {
          AccessibilityInfo.announceForAccessibility(LOOKUP_ERROR_TEXT[kind]);
        }
      }
    },
    [dispatch, haptics, returnAfterLog, navigation],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeResult) => {
      if (!isFocused || hasLockedRef.current || scanPausedRef.current) return;

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

      // Armed here, before the branches, so the first frame of a sighting
      // gets it too: a code seen for one frame must still time out to
      // HUNTING. Every later frame clears it at the top of this callback, and
      // a lock (hasLockedRef) clears it below.
      barcodeAbsentTimerRef.current = setTimeout(() => {
        dispatch({ type: "BARCODE_LOST" });
      }, 800);

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
        clearTimeout(barcodeAbsentTimerRef.current);
        barcodeAbsentTimerRef.current = null;
        dispatch({ type: "BARCODE_LOCKED" });
        // A redo that found the same barcode resumes its saved step: only a
        // fresh lock needs the lookup (and its severe-flag haptic).
        if (scanPhaseRef.current.type === "BARCODE_LOCKED") {
          void fetchProductInfo(barcode);
        }
        return;
      }
    },
    [isFocused, screenWidth, screenHeight, fetchProductInfo, haptics, dispatch],
  );

  const onShutterPress = useCallback(async () => {
    const phase = scanPhaseRef.current;
    const capturePlan = getCapturePlan(phase, captureMode);
    if (!capturePlan.capture) {
      // Was a bare `return`. Silence here is indistinguishable from a broken
      // button for a screen-reader user, which is exactly how this was
      // reported. Ungated across platforms: on iOS the disabled trait is
      // descriptive only (Pressable is an RCTView, not a UIControl), so
      // VoiceOver's double-tap still lands here; on Android the RN delegate
      // sets the SEMANTIC AccessibilityNodeInfo enabled=false without gating
      // real click dispatch, so this is expected to fire under TalkBack too —
      // and if a TalkBack version declines to click a disabled-reporting node,
      // the announced "disabled" state itself covers the user. No-op when no
      // reader is running.
      const blocked = getShutterBlockedReason(phase, captureMode);
      if (blocked) AccessibilityInfo.announceForAccessibility(blocked);
      return;
    }

    // Guard against duplicate captures from rapid taps — ref check is synchronous
    // and avoids the re-render cycle that makes `disabled` lag behind fast input.
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;

    // The body lives in an inner function so the guard reset below is a
    // catch-and-rethrow rather than a try/finally (React Compiler cannot lower
    // a TryStatement without a catch clause).
    // One small function per capture route (getCapturePlan picks the route; the
    // mode branches that used to live here are gone).
    const captureFrontLabel = async (photoUri: string) => {
      // Front-label mode (the "Add product details" CTA and FrontLabelConfirm's
      // Retake): hand the photo and the product's barcode to FrontLabelConfirm,
      // which runs the AI extraction itself because sessionId is null. On-device
      // OCR only seeds a preview, so its failure is non-fatal.
      if (!verifyBarcode) return; // narrowing only: the plan routes here iff set
      let data = EMPTY_FRONT_LABEL;
      try {
        const ocrResult = await recognizeTextFromPhoto(photoUri);
        if (ocrResult.text) data = parseFrontLabelFromOCR(ocrResult.text);
      } catch (err) {
        logger.error(
          "[ScanScreen front-label OCR] recognition failed; navigating without preview",
          err,
        );
      }
      navigation.navigate("FrontLabelConfirm", {
        imageUri: photoUri,
        barcode: verifyBarcode,
        sessionId: null,
        data,
      });
    };

    // Label mode: skip smart classification, go directly to LabelAnalysis.
    // On-device snapshot OCR pre-fills an instant preview; the server does the
    // authoritative analysis, so OCR failure here is non-fatal (preview absent).
    // With a verifyBarcode (NutritionDetail's "Help verify this product"),
    // LabelAnalysis submits a verification for that barcode instead of logging.
    const captureLabel = async (photoUri: string) => {
      let localOCRText: string | undefined;
      try {
        const ocrResult = await recognizeTextFromPhoto(photoUri);
        if (ocrResult.text) localOCRText = ocrResult.text;
      } catch (err) {
        logger.error(
          "[ScanScreen label OCR] recognition failed; navigating without preview",
          err,
        );
      }
      navigation.navigate("LabelAnalysis", {
        imageUri: photoUri,
        localOCRText,
        ...(verifyBarcode
          ? {
              barcode: verifyBarcode,
              verificationMode: true,
              verifyBarcode,
            }
          : {}),
      });
    };

    const captureSmart = async (photoUri: string) => {
      // Picked on PhotoIntent: skip classification and go to that flow. The
      // premium lock is re-checked here because the param can arrive without
      // passing PhotoIntentScreen's own lock.
      if (pickedIntent) {
        if (
          isScanIntentLocked(
            pickedIntent,
            features,
            !!features.recipeGeneration && !!canGenerateRecipe,
          )
        ) {
          trackTempUri(photoUri);
          resetScan();
          setShowUpgradeModal(true);
          return;
        }
        const localOCRText =
          pickedIntent === "menu"
            ? await resolveMenuLocalOCRText(
                "restaurant_menu",
                photoUri,
                recognizeTextFromPhoto,
              )
            : undefined;
        const picked = getRouteForPickedIntent(
          pickedIntent,
          photoUri,
          localOCRText,
        );
        switch (picked.screen) {
          case "PhotoAnalysis":
            navigation.navigate("PhotoAnalysis", picked.params);
            break;
          case "LabelAnalysis":
            navigation.navigate("LabelAnalysis", picked.params);
            break;
          case "MenuScanResult":
            navigation.navigate("MenuScanResult", picked.params);
            break;
          case "CookSessionCapture":
            navigation.navigate("CookSessionCapture", picked.params);
            break;
          default:
            // getRouteForPickedIntent only yields the four arms above.
            break;
        }
        return;
      }

      trackTempUri(photoUri);
      dispatch({ type: "SMART_PHOTO_INITIATED", imageUri: photoUri });
      try {
        const result = await uploadPhotoForAnalysis(photoUri, "auto");
        dispatch({
          type: "CLASSIFICATION_SUCCEEDED",
          classification: result,
        });
        haptics.notification(
          getConfidenceHapticType(getConfidenceTier(result.overallConfidence)),
        );
      } catch (err) {
        // Stale dispatch is safe — reducer no-ops CLASSIFICATION_FAILED when state !== CLASSIFYING
        dispatch({
          type: "CLASSIFICATION_FAILED",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    };

    const captureStep = async (photoUri: string) => {
      // Flash immediately after capture, before async OCR
      setFlashCount((c) => c + 1);
      trackTempUri(photoUri);

      if (capturePlan.runStepOcr) {
        let ocrText = "";
        try {
          const ocrResult = await recognizeTextFromPhoto(photoUri);
          if (ocrResult.text != null) ocrText = ocrResult.text;
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
        dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photoUri, ocrText });
      } else {
        // STEP2_CONFIRMED (front-label capture) — no OCR needed
        dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photoUri });
      }
    };

    const runCapture = async () => {
      const photo = await cameraRef.current?.takePicture();
      if (!photo) {
        Alert.alert("Capture failed", "Please try again.");
        return;
      }
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      switch (capturePlan.route) {
        case "frontLabel":
          await captureFrontLabel(photo.uri);
          break;
        case "label":
          await captureLabel(photo.uri);
          break;
        case "smart":
          await captureSmart(photo.uri);
          break;
        case "step":
          await captureStep(photo.uri);
          break;
      }
    };
    try {
      await runCapture();
    } catch (err) {
      isCapturingRef.current = false;
      throw err;
    }
    isCapturingRef.current = false;
  }, [
    dispatch,
    captureMode,
    verifyBarcode,
    pickedIntent,
    features,
    canGenerateRecipe,
    resetScan,
    navigation,
    haptics,
    trackTempUri,
  ]);

  // ExampleCard is silent on appear and has no live region; name it for a
  // screen reader on both platforms.
  useEffect(() => {
    if (exampleCardKey) {
      // Batched with the tabs changing in the same commit; content leads.
      announceTogether(EXAMPLE_CONTENT[exampleCardKey].title, { first: true });
    }
  }, [exampleCardKey]);

  // A ✓ tab: redo that step, keeping every other step's work.
  const onRedoStep = useCallback(
    (step: "barcode" | "nutrition") => {
      const phase = scanPhaseRef.current;
      if (step === "barcode") {
        // Clear the lock gate, or the next sighting could never lock.
        hasLockedRef.current = false;
      } else if (phase.type === "STEP2_CONFIRMED" && phase.nutritionImageUri) {
        // The old label photo is replaced, as on Retake.
        discardTempUri(phase.nutritionImageUri);
      }
      dispatch({ type: "REDO_STEP", step });
    },
    [dispatch, discardTempUri],
  );

  // Typed barcode: the same lock and lookup as a scanned one.
  const onManualBarcode = useCallback(
    (barcode: string) => {
      setManualVisible(false);
      if (!acceptsBarcode(scanPhaseRef.current)) return;
      if (barcodeAbsentTimerRef.current) {
        clearTimeout(barcodeAbsentTimerRef.current);
        barcodeAbsentTimerRef.current = null;
      }
      hasLockedRef.current = true;
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      dispatch({ type: "MANUAL_BARCODE_ENTERED", barcode });
      // A redo that found the same barcode resumes its step; only a fresh
      // lock needs the lookup.
      if (scanPhaseRef.current.type === "BARCODE_LOCKED") {
        void fetchProductInfo(barcode);
      }
    },
    [dispatch, fetchProductInfo, haptics],
  );

  const stepExampleKey = getStepExampleKey(view);
  const { showExample } = onboarding;
  // Plain function: React Compiler memoizes it (a manual useCallback over
  // the per-render `view` could not be preserved).
  const onShowExampleFromHelp = () => {
    setHelpVisible(false);
    showExample(stepExampleKey);
  };

  // Permission screens
  if (!permission || permission.status === "undetermined") {
    return (
      <CameraPermissionGate
        status="undetermined"
        onRequestPermission={requestPermission}
        onCancel={goBackOrMain}
      />
    );
  }

  if (permission.status === "denied") {
    return (
      <CameraPermissionGate
        status="denied"
        onRequestPermission={requestPermission}
        onCancel={goBackOrMain}
      />
    );
  }

  // Quiet under a teaching surface (the hint would draw over its scrim).
  const coachMessage = teachingUp
    ? ""
    : getFlowCoachMessage(
        scanPhase,
        view.hint,
        elapsedSeconds,
        isBarcodeFlow ? "barcode" : "generic",
      );

  // Android TalkBack focus trap for the overlays (no-op on iOS). The static
  // camera UI and ProductChip need different values — see getScanOverlayA11y.
  // The Front step's prompt card is hidden in the shell (Skip replaces it).
  const chipVariant = getProductChipVariant(scanPhase);
  const productChipVisible =
    chipVariant !== null && chipVariant !== "step2_confirmed";
  const overlayA11y = getScanOverlayA11y(!!confirmCard, productChipVisible);
  // The carousel / example card is the only thing a screen reader should
  // reach: accessibilityViewIsModal is iOS-only, so TalkBack needs the static
  // camera UI hidden too.
  const staticUIImportance = teachingUp
    ? "no-hide-descendants"
    : overlayA11y.staticUI;

  // Same source of truth as onShutterPress's guard — the visual must never
  // claim the shutter is dead in a phase that captures (LABEL_PROMPTED
  // rendered un-armed, faithfully reflecting the broken behaviour), nor armed
  // in one that doesn't.
  const shutterArmed = getCapturePlan(scanPhase, captureMode).capture;
  // Same phase, same source of truth as `shutterArmed` — drives the hint that
  // explains a dead shutter before the user taps it, not only after.
  const shutterBlockedReason = getShutterBlockedReason(scanPhase, captureMode);

  const scansBarcodes = isBarcodeFlow;
  // Step 1 of the barcode flow: no shutter, the keypad on the right.
  const onBarcodeStep = isBarcodeFlow && acceptsBarcode(scanPhase);
  const productNotFound =
    scanPhase.type === "BARCODE_LOCKED" &&
    scanPhase.barcode === notFoundBarcode;
  const lookupErrorKind =
    scanPhase.type === "BARCODE_LOCKED" &&
    lookupError?.barcode === scanPhase.barcode
      ? lookupError.kind
      : null;

  const shutter = view.showShutter ? (
    <Pressable
      style={[styles.shutter, shutterArmed && styles.shutterArmed]}
      onPress={onShutterPress}
      accessibilityLabel="Take photo"
      accessibilityRole="button"
      // Mirrors the armed state into the a11y tree from the SAME
      // `shutterArmed` the yellow border reads, so the two can't diverge.
      // Set explicitly rather than via `disabled`: the file deliberately
      // gates capture on a synchronous ref (see `onShutterPress`) because
      // `disabled` lags behind fast input, and a real `disabled` would also
      // swallow the press before the announcement above could explain it.
      accessibilityState={{ disabled: !shutterArmed }}
      // Known tradeoff: iOS reads a hint at focus time and does not
      // re-announce it if the phase changes while focus stays parked here
      // (e.g. IDLE → HUNTING seconds after mount), so a parked user can
      // hold a stale hint. Accepted because the press-time announce above
      // always reports the ACTUAL outcome; the hint is first-contact
      // orientation, not the source of truth.
      accessibilityHint={
        shutterBlockedReason ?? "Captures a photo of what the camera sees"
      }
    />
  ) : null;

  const torch = (
    <TouchableOpacity
      style={[styles.iconBtn, styles.iconBtnVisible]}
      onPress={() => {
        haptics.selection();
        setTorchEnabled((t) => !t);
      }}
      accessibilityLabel="Flashlight"
      accessibilityRole="switch"
      accessibilityState={{ checked: torchEnabled }}
    >
      <Feather
        name={torchEnabled ? "zap" : "zap-off"}
        size={20}
        color={TORCH_ICON_COLOR}
        accessible={false}
      />
    </TouchableOpacity>
  );

  let rightControl: React.ReactNode = null;
  if (view.showSkip) {
    rightControl = (
      <TouchableOpacity
        style={styles.skipBtn}
        onPress={() => {
          haptics.selection();
          dispatch({ type: "SKIP_STEP" });
        }}
        accessibilityLabel="Skip"
        accessibilityRole="button"
      >
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>
    );
  } else if (onBarcodeStep) {
    rightControl = (
      <TouchableOpacity
        style={[styles.iconBtn, styles.iconBtnVisible]}
        onPress={() => {
          haptics.selection();
          setManualVisible(true);
        }}
        accessibilityLabel="Type the barcode number"
        accessibilityRole="button"
      >
        <Feather
          name="hash"
          size={20}
          color={TORCH_ICON_COLOR}
          accessible={false}
        />
      </TouchableOpacity>
    );
  }

  return (
    <CameraShell
      camera={
        <CameraView
          ref={cameraRef}
          barcodeTypes={
            scansBarcodes
              ? ["ean13", "ean8", "upc_e", "code128", "code39", "qr"]
              : []
          }
          onBarcodeScanned={scansBarcodes ? onBarcodeScanned : undefined}
          enableTorch={torchEnabled}
          isActive={isFocused && !confirmCard}
        />
      }
      frame={
        <>
          <ScanReticle
            phase={scanPhase}
            reducedMotion={reducedMotion}
            shape={view.frame}
          />
          {sonarVisible && (
            <ScanSonarRing
              cx={sonarPos.cx}
              cy={sonarPos.cy}
              onComplete={() => setSonarVisible(false)}
            />
          )}
          <ScanFlashOverlay triggerCount={flashCount} />
        </>
      }
      overlay={
        exampleCardKey ? (
          <ExampleCard
            exampleKey={exampleCardKey}
            onDismiss={onboarding.onExampleDismiss}
          />
        ) : null
      }
      onClose={goBackOrMain}
      title={isBarcodeFlow ? null : (view.title ?? null)}
      onHelp={isBarcodeFlow ? () => setHelpVisible(true) : null}
      topAccessory={
        !isPremium && remainingScans !== null ? (
          <View style={styles.scanCountPill}>
            <Text style={styles.scanCountText}>
              {remainingScans > 0
                ? `${remainingScans} scans remaining`
                : "Daily limit reached"}
            </Text>
          </View>
        ) : null
      }
      hint={<CoachHint message={coachMessage} />}
      tabs={
        view.tabs.length > 0 ? (
          <StepTabs tabs={view.tabs} onRedo={onRedoStep} />
        ) : null
      }
      left={torch}
      shutter={shutter}
      right={rightControl}
      chromeHidden={productChipVisible}
      // The feed holds (dims) behind the green frame until the user acts on
      // the found card; "Not this" (RESCAN) leaves BARCODE_LOCKED and lifts it.
      feedHeld={scanPhase.type === "BARCODE_LOCKED"}
      controlsMuted={exampleCardKey !== null}
      obscured={teachingUp}
      staticUIImportance={staticUIImportance}
    >
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
        productNotFound={productNotFound}
        hideFrontPrompt
        returnAfterLog={returnAfterLog}
        lookupError={lookupErrorKind}
        // Try again: the same lookup for the barcode locked now.
        onRetryLookup={() => {
          const phase = scanPhaseRef.current;
          if (phase.type === "BARCODE_LOCKED") {
            void fetchProductInfo(phase.barcode);
          }
        }}
        // Type it in: drop the lock (as "Not this") and open the sheet.
        onTypeBarcode={() => {
          hasLockedRef.current = false;
          dispatch({ type: "RESCAN" });
          setManualVisible(true);
        }}
        isSmartConfirming={isSmartConfirming}
        screenReaderEnabled={screenReaderEnabled}
        phase={scanPhase}
        onConfirm={() => dispatch({ type: "CONFIRM_PRODUCT" })}
        // "Not this": drop the lock and resume scanning. Clear the lock gate
        // first so the next sighting can lock (onBarcodeScanned returns early
        // while it is set).
        onRescan={() => {
          hasLockedRef.current = false;
          dispatch({ type: "RESCAN" });
        }}
        onProceedToLabel={() => dispatch({ type: "PROCEED_TO_LABEL" })}
        onStepConfirmed={() => dispatch({ type: "STEP_CONFIRMED" })}
        // Retake stays in the wizard (owner decision 2026-11-22): no
        // navigate, so no blur reset — the barcode and earlier photos are
        // kept. Only the discarded photo is deleted.
        // The live ref, not the render closure: a tap landing as the 1.5 s
        // auto-advance fires would otherwise delete a photo the next phase
        // keeps (the reducer then no-ops the retake).
        onRetakeStep2={() => {
          const phase = scanPhaseRef.current;
          if (phase.type !== "STEP2_REVIEWING") return;
          discardTempUri(phase.imageUri);
          dispatch({ type: "RETAKE_STEP" });
        }}
        onRetakeStep3={() => {
          const phase = scanPhaseRef.current;
          if (phase.type !== "STEP3_REVIEWING") return;
          discardTempUri(phase.frontImageUri);
          dispatch({ type: "RETAKE_STEP" });
        }}
        onSmartPhotoConfirm={async () => {
          if (scanPhase.type !== "SMART_CONFIRMED") return;
          if (isConfirmingRef.current) return;
          isConfirmingRef.current = true;
          setIsSmartConfirming(true);
          const { classification, imageUri } = scanPhase;
          // Inner function + catch-and-rethrow instead of try/finally (React
          // Compiler cannot lower a TryStatement without a catch clause).
          const runSmartConfirm = async () => {
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
                // ClassificationRoute is a discriminated union keyed on `screen` —
                // switch on the literal so each arm gets React Navigation's
                // per-screen param type instead of casting the whole navigate
                // signature away (docs/rules/typescript.md: never cast navigation
                // types with `as never`/`as unknown`).
                //
                // Only release (without deleting) when the destination's own
                // params actually carry `imageUri` — ownership genuinely
                // transfers there. `ReceiptCapture` (`params: undefined`) and
                // `NutritionDetail` (`params: { barcode }`) never receive the
                // file, so releasing it there would forget it from
                // `pendingTempUrisRef` without anything else ever deleting
                // it. Leaving it tracked for those two arms is deliberate:
                // this navigate blurs ScanScreen, and the existing "Reset
                // when screen loses focus" effect above already deletes
                // anything still pending via resetScan() -> cleanupPendingUris().
                switch (action.route.screen) {
                  case "PhotoAnalysis":
                    releaseTempUri(imageUri);
                    navigation.navigate("PhotoAnalysis", action.route.params);
                    break;
                  case "LabelAnalysis":
                    releaseTempUri(imageUri);
                    navigation.navigate("LabelAnalysis", action.route.params);
                    break;
                  case "MenuScanResult":
                    releaseTempUri(imageUri);
                    navigation.navigate("MenuScanResult", action.route.params);
                    break;
                  case "CookSessionCapture":
                    releaseTempUri(imageUri);
                    navigation.navigate(
                      "CookSessionCapture",
                      action.route.params,
                    );
                    break;
                  case "ReceiptCapture":
                    navigation.navigate("ReceiptCapture");
                    break;
                  case "NutritionDetail":
                    navigation.navigate("NutritionDetail", action.route.params);
                    break;
                  default: {
                    // Exhaustiveness guard: a new ClassificationRoute member must
                    // be handled here — a silent no-op is exactly the bug the
                    // outer switch's own guard above exists to prevent.
                    const _exhaustive: never = action.route;
                    throw new Error(
                      `unhandled classification route: ${String(_exhaustive)}`,
                    );
                  }
                }
                break;
              case "blocked":
                // blocked: hide the chip (RESET) and show the upsell. RESET-on-block
                // (not on modal close) avoids leaving a stale interactive confirm chip
                // in the a11y tree behind the modal. Focus-trap safety itself does not
                // hinge on ordering — UpgradeModal is a RN <Modal> in its own native
                // window, so its trap never nests with the chip's accessibilityViewIsModal
                // (which lingers through its spring-out). The camera sits at IDLE behind
                // until the upsell closes (rearmScan).
                resetScan();
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
              case "barcodeHandoff":
                // wired in Task 4
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
          };
          try {
            await runSmartConfirm();
          } catch (err) {
            isConfirmingRef.current = false;
            setIsSmartConfirming(false);
            throw err;
          }
          isConfirmingRef.current = false;
          setIsSmartConfirming(false);
        }}
        onRetry={rearmScan}
      />

      {confirmCard && (
        <ScanConfirmOverlay
          confirmCard={confirmCard}
          onDismiss={handleConfirmDismiss}
          onLog={handleConfirmLog}
        />
      )}

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => {
          setShowUpgradeModal(false);
          rearmScan();
        }}
      />

      {isBarcodeFlow ? (
        <>
          <HelpSheet
            visible={helpVisible}
            stepTitle={EXAMPLE_CONTENT[stepExampleKey].title}
            stepHint={view.hint}
            showTypeNumberTip={stepExampleKey === "barcode"}
            onShowExample={onShowExampleFromHelp}
            onClose={() => setHelpVisible(false)}
          />
          <ManualBarcodeSheet
            visible={manualVisible}
            onSubmit={onManualBarcode}
            onClose={() => setManualVisible(false)}
          />
        </>
      ) : null}

      {/* Once ever, before the first scan: over everything. */}
      {onboarding.carouselVisible ? (
        <View style={styles.carousel} accessibilityViewIsModal>
          <TipsCarousel onDone={onboarding.onCarouselDone} />
        </View>
      ) : null}
    </CameraShell>
  );
}

const styles = StyleSheet.create({
  // Above the shell's chrome (zIndex 10), which would otherwise draw over it
  // and take its taps.
  carousel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnVisible: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  skipBtn: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: CameraColors.overlayMedium,
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: {
    color: CameraColors.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FFF", // hardcoded — camera overlay
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.3)",
  },
  shutterArmed: {
    borderColor: "#FFD60A", // hardcoded — matches FocusRing's focus-ring yellow (Task 6)
    shadowColor: "#FFD60A", // hardcoded — same focus-ring yellow, for the shadow glow
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  scanCountPill: {
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  scanCountText: { color: "rgba(255,255,255,0.75)", fontSize: 12 },
});
