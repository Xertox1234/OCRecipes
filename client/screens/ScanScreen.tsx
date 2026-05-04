import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from "react-native-reanimated";
import ConfettiCannon from "react-native-confetti-cannon";
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  Pressable,
  Linking,
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
import { useTheme } from "@/hooks/useTheme";
import { usePremiumCamera } from "@/hooks/usePremiumFeatures";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  useCameraPermissions,
  CameraView,
  recognizeTextFromPhoto,
  type BarcodeResult,
  type CameraRef,
} from "@/camera";

import { scanPhaseReducer } from "@/camera/reducers/scan-phase-reducer";
import { CoachHint } from "@/camera/components/CoachHint";
import { ScanReticle } from "@/camera/components/ScanReticle";
import { StepPill } from "@/camera/components/StepPill";
import { ProductChip } from "@/camera/components/ProductChip";
import { ScanFlashOverlay } from "@/camera/components/ScanFlashOverlay";
import { ScanSonarRing } from "@/camera/components/ScanSonarRing";
import { getCoachMessage } from "@/camera/components/CoachHint-utils";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { uploadPhotoForAnalysis } from "@/lib/photo-upload";
import {
  getPremiumGate,
  getRouteForContentType,
} from "@/screens/scan-screen-utils";
import {
  buildLoadingConfirmCard,
  buildLoadedConfirmCard,
  buildFetchErrorConfirmCard,
  buildScannedItemPayload,
  buildSuccessToastMessage,
  canLog,
  type ConfirmCardState,
} from "@/screens/ScanScreenConfirmOverlay-utils";
import { ThemedText } from "@/components/ThemedText";
import { useToast } from "@/context/ToastContext";
import {
  withOpacity,
  Spacing,
  BorderRadius,
  FontFamily,
} from "@/constants/theme";
import type { ScanScreenNavigationProp } from "@/types/navigation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { FrontLabelExtractionResult } from "@shared/types/front-label";
import type { ContentType } from "@shared/constants/classification";

const LOCK_THRESHOLD = 0.85; // confidence ≥ 0.85 ≈ 6+ stable frames (frameCount/7)

export default function ScanScreen() {
  const navigation = useNavigation<ScanScreenNavigationProp>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { isPremium, remainingScans } = usePremiumCamera();
  const { refreshScanCount } = usePremiumContext();
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

  // Corner glow for OCR text detection feedback (label mode only)
  const cornerGlow = useSharedValue(0);

  const handleTextDetected = useCallback(
    (detected: boolean) => {
      if (reducedMotion) {
        cornerGlow.value = detected ? 1 : 0;
      } else {
        cornerGlow.value = detected
          ? withTiming(1, { duration: 300 })
          : withTiming(0, { duration: 500 });
      }
    },
    [cornerGlow, reducedMotion],
  );

  const successColor = theme.success;
  const glowStyle = useAnimatedStyle(() => ({
    shadowColor: successColor,
    shadowRadius: cornerGlow.value * 8,
    shadowOpacity: cornerGlow.value * 0.6,
    shadowOffset: { width: 0, height: 0 },
    elevation: cornerGlow.value * 4,
  }));

  const [confirmCard, setConfirmCard] = useState<ConfirmCardState | null>(null);

  const cameraRef = useRef<CameraRef>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barcodeAbsentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasLockedRef = useRef(false);
  const sessionNavigatedRef = useRef(false);
  const scanPhaseRef = useRef(scanPhase);
  const reducedMotionRef = useRef(reducedMotion);

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

  // Keep scanPhaseRef current so onShutterPress can read it without being in deps
  useEffect(() => {
    scanPhaseRef.current = scanPhase;
  }, [scanPhase]);

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

    const { barcode, nutritionImageUri, frontImageUri, ocrText } = scanPhase;

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
      refreshScanCount();
      navigation.navigate("NutritionDetail", {
        barcode,
        nutritionImageUri,
        frontLabelImageUri: frontImageUri,
        localOCRText: ocrText,
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [scanPhase, navigation, refreshScanCount, reducedMotion, returnAfterLog]);

  const handleConfirmLog = useCallback(async () => {
    if (!confirmCard || !canLog(confirmCard)) return;
    setConfirmCard((prev) => prev && { ...prev, isLogging: true });
    try {
      await apiRequest(
        "POST",
        "/api/scanned-items",
        buildScannedItemPayload(confirmCard),
      );
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      refreshScanCount();
      toast.success(buildSuccessToastMessage(confirmCard));
      navigation.goBack();
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
      if (__DEV__) console.warn("[fetchProductInfo]", err);
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

      if (scanPhase.type === "HUNTING") {
        dispatch({ type: "FIRST_BARCODE_DETECTED", barcode, bounds });
        return;
      }

      if (scanPhase.type === "BARCODE_TRACKING") {
        if (barcode !== scanPhase.barcode) {
          dispatch({ type: "FIRST_BARCODE_DETECTED", barcode, bounds });
          return;
        }
        dispatch({ type: "BARCODE_UPDATED", bounds });

        const newFrameCount = scanPhase.frameCount + 1;
        const confidence = Math.min(newFrameCount / 7, 1.0);

        if (confidence >= LOCK_THRESHOLD) {
          hasLockedRef.current = true;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          if (!reducedMotionRef.current) {
            setFlashCount((c) => c + 1);
            setSonarPos({
              cx: (bounds.x + bounds.width / 2) * screenWidth,
              cy: (bounds.y + bounds.height / 2) * screenHeight,
            });
            setSonarVisible(true);
          }
          dispatch({ type: "BARCODE_LOCKED" });
          fetchProductInfo(barcode);
        } else {
          barcodeAbsentTimerRef.current = setTimeout(() => {
            dispatch({ type: "BARCODE_LOST" });
          }, 800);
        }
      }
    },
    [isFocused, scanPhase, screenWidth, screenHeight, fetchProductInfo],
  );

  const onShutterPress = useCallback(async () => {
    const phase = scanPhaseRef.current;
    if (
      phase.type !== "STEP2_CAPTURING" &&
      phase.type !== "STEP3_CAPTURING" &&
      phase.type !== "HUNTING"
    )
      return;

    if (phase.type === "HUNTING") {
      const photo = await cameraRef.current?.takePicture();
      if (!photo) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Label mode: skip smart classification, go directly to LabelAnalysis
      if (isLabelMode) {
        const ocrResult = cameraRef.current?.getLatestOCRResult?.();
        navigation.navigate("LabelAnalysis", {
          imageUri: photo.uri,
          localOCRText: ocrResult?.resultText ?? undefined,
        });
        return;
      }

      dispatch({ type: "SMART_PHOTO_INITIATED", imageUri: photo.uri });
      try {
        const result = await uploadPhotoForAnalysis(photo.uri, "auto");
        dispatch({ type: "CLASSIFICATION_SUCCEEDED", classification: result });
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
    if (!photo) return;

    // Haptic + flash immediately after capture, before async OCR
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFlashCount((c) => c + 1);

    if (phase.type === "STEP2_CAPTURING") {
      let ocrText = "";
      try {
        const ocrResult = await recognizeTextFromPhoto(photo.uri);
        ocrText = ocrResult.text ?? "";
      } catch (err) {
        if (__DEV__) console.warn("[onShutterPress OCR]", err);
      }
      dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photo.uri, ocrText });
    } else {
      // STEP3_CAPTURING — no OCR needed
      dispatch({ type: "STEP_PHOTO_CAPTURED", imageUri: photo.uri });
    }
  }, [isLabelMode, navigation]);

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
          onPress={() => navigation.goBack()}
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

  return (
    <View style={styles.root}>
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
        enableOCR={isLabelMode}
        onTextDetected={isLabelMode ? handleTextDetected : undefined}
      />

      {isLabelMode ? (
        <Animated.View
          style={[styles.reticleGlowWrapper, glowStyle]}
          pointerEvents="none"
        >
          <ScanReticle phase={scanPhase} reducedMotion={reducedMotion} />
        </Animated.View>
      ) : (
        <ScanReticle phase={scanPhase} reducedMotion={reducedMotion} />
      )}

      {sonarVisible && (
        <ScanSonarRing
          cx={sonarPos.cx}
          cy={sonarPos.cy}
          onComplete={() => setSonarVisible(false)}
        />
      )}

      <ScanFlashOverlay triggerCount={flashCount} />

      {/* Top overlay */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Close camera"
          accessibilityRole="button"
        >
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <StepPill phase={scanPhase} />
      </View>

      {/* Coach hint */}
      <View style={styles.coachContainer}>
        <CoachHint message={coachMessage} />
      </View>

      {/* Bottom controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
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
          style={styles.shutter}
          onPress={onShutterPress}
          accessibilityLabel="Take photo"
          accessibilityRole="button"
        />
        <View style={styles.iconBtn} />
      </View>

      {/* Scan count badge (free tier) */}
      {!isPremium && remainingScans !== null && (
        <View style={styles.scanCount}>
          <Text style={styles.scanCountText}>
            {remainingScans > 0
              ? `${remainingScans} scans remaining`
              : "Daily limit reached"}
          </Text>
        </View>
      )}

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
        phase={scanPhase}
        onConfirm={() => dispatch({ type: "CONFIRM_PRODUCT" })}
        onAddNutritionPhoto={() => dispatch({ type: "ADD_NUTRITION_PHOTO" })}
        onAddFrontPhoto={() => dispatch({ type: "ADD_FRONT_PHOTO" })}
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
        onSmartPhotoConfirm={() => {
          if (scanPhase.type !== "SMART_CONFIRMED") return;
          const { classification, imageUri } = scanPhase;
          const contentType = classification.contentType;
          if (!contentType) {
            navigation.navigate("PhotoAnalysis", {
              imageUri,
              intent: classification.resolvedIntent ?? "log",
            });
            return;
          }
          const gate = getPremiumGate(contentType);
          if (gate && !isPremium) {
            dispatch({ type: "RESET" });
            return;
          }
          const route = getRouteForContentType(
            contentType,
            imageUri,
            classification.resolvedIntent ?? null,
            classification.barcode ?? null,
          );
          if (route) {
            // navigate accepts a variable screen name from a discriminated union;
            // cast the whole function signature to avoid React Navigation's strict
            // per-screen overloads while keeping params typed via ClassificationRoute.
            (
              navigation.navigate as (
                screen: string,
                params?: Record<string, unknown>,
              ) => void
            )(
              route.screen,
              route.params as Record<string, unknown> | undefined,
            );
          } else {
            dispatch({ type: "RESET" });
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
            <View style={styles.confirmLoadingRow}>
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
                        : theme.link,
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" }, // hardcoded — camera background must always be black
  reticleGlowWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
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
  scanCount: {
    position: "absolute",
    top: 120,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
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
