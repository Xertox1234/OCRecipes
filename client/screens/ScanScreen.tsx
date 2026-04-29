import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Platform,
  Linking,
  ActivityIndicator,
  AccessibilityInfo,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
} from "react-native-reanimated";
import { useSuccessFlash } from "@/hooks/useSuccessAnimation";
import {
  useNavigation,
  useIsFocused,
  useRoute,
  RouteProp,
} from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { ClassificationOverlay } from "@/components/ClassificationOverlay";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useScanClassification } from "@/hooks/useScanClassification";
import { Spacing, BorderRadius, CameraColors } from "@/constants/theme";
import { UpgradeModal } from "@/components/UpgradeModal";
import type { ScanScreenNavigationProp } from "@/types/navigation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { uploadFrontLabelPhoto } from "@/lib/photo-upload";
import { parseFrontLabelFromOCR } from "@/lib/front-label-ocr-parser";

// Camera abstraction imports
import {
  CameraView,
  useCameraPermissions,
  useCamera,
  type BarcodeResult,
} from "@/camera";
import { usePremiumCamera } from "@/hooks/usePremiumFeatures";
import { usePremiumContext } from "@/context/PremiumContext";

const AnimatedView = Animated.createAnimatedComponent(View);

/** Timing constants for scan operations */
const SCAN_TIMING = {
  /** Debounce between barcode scans to prevent duplicates */
  SCAN_DEBOUNCE_MS: 2000,
  /** Delay before navigation to allow success animation */
  NAVIGATION_DELAY_MS: 300,
  /** Delay before resetting scan state after navigation */
  RESET_DELAY_MS: 500,
} as const;

/** Reticle dimensions for barcode scanning viewfinder */
const RETICLE = {
  WIDTH: 280,
  HEIGHT: 180,
  CORNER_SIZE: 40,
  CORNER_BORDER_WIDTH: 4,
  CORNER_RADIUS: 16,
} as const;

/** Larger frame for nutrition label scanning */
const LABEL_FRAME = {
  WIDTH: 300,
  HEIGHT: 400,
  CORNER_SIZE: 40,
  CORNER_BORDER_WIDTH: 4,
  CORNER_RADIUS: 16,
} as const;

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<ScanScreenNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, "Scan">>();
  const isFocused = useIsFocused();

  const isLabelMode = route.params?.mode === "label";
  const isFrontLabelMode = route.params?.mode === "front-label";
  const verifyBarcode = route.params?.verifyBarcode;
  const frame = isLabelMode || isFrontLabelMode ? LABEL_FRAME : RETICLE;
  const {
    permission,
    isLoading: permissionLoading,
    requestPermission,
  } = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const haptics = useHaptics();

  // Premium features
  const {
    availableBarcodeTypes,
    canScan,
    remainingScans,
    isPremium,
    highQualityCapture,
  } = usePremiumCamera();
  const { refreshScanCount } = usePremiumContext();

  // Smart scan classification state
  const onUpgradeNeeded = useCallback(() => {
    setShowUpgradeModal(true);
  }, []);

  const {
    classifyState,
    classifyResult,
    navigationTimeoutRef,
    resetTimeoutRef,
    handleSmartScan,
    handleConfirm,
    handleDismiss,
    handleRetake,
  } = useScanClassification({
    isPremium,
    refreshScanCount,
    onUpgradeNeeded,
    isFocused,
  });

  const pulseScale = useSharedValue(1);
  const cornerOpacity = useSharedValue(0.6);
  const scanSuccessScale = useSharedValue(0);
  const cornerGlow = useSharedValue(0);

  // Green flash overlay on barcode scan success
  const { trigger: triggerScanFlash, animatedStyle: scanFlashStyle } =
    useSuccessFlash(0.15);

  // Ref used to call resetScanning inside onBarcodeScanSuccess without creating
  // a circular dependency (onBarcodeScanSuccess → useCamera → resetScanning).
  const resetScanningRef = useRef<() => void>(() => {});

  // Memoized callback prevents re-registration of the native scanner on every render.
  // triggerScanFlash owns the haptic (Success) — do not add a separate haptics call here.
  const onBarcodeScanSuccess = useCallback(
    async (result: BarcodeResult) => {
      scanSuccessScale.value = withSequence(
        withSpring(1.2, { damping: 10 }),
        withSpring(1, { damping: 15 }),
      );
      triggerScanFlash();

      // Navigate after brief delay for animation (with cleanup tracking)
      navigationTimeoutRef.current = setTimeout(() => {
        navigation.navigate("NutritionDetail", { barcode: result.data });
        // Refresh scan count after navigation
        refreshScanCount();
        resetTimeoutRef.current = setTimeout(() => {
          resetScanningRef.current();
          scanSuccessScale.value = 0;
        }, SCAN_TIMING.RESET_DELAY_MS);
      }, SCAN_TIMING.NAVIGATION_DELAY_MS);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scanSuccessScale is a stable useSharedValue ref that never changes identity
    [
      triggerScanFlash,
      navigationTimeoutRef,
      navigation,
      refreshScanCount,
      resetTimeoutRef,
    ],
  );

  // Camera hook with debouncing
  const { cameraRef, isScanning, handleBarcodeScanned, resetScanning } =
    useCamera({
      onBarcodeScanned: onBarcodeScanSuccess,
      debounceMs: SCAN_TIMING.SCAN_DEBOUNCE_MS,
    });

  // Keep the ref in sync so the memoized callback always calls the latest resetScanning
  resetScanningRef.current = resetScanning;

  // Announce scanning state changes for iOS (accessibilityLiveRegion is Android-only)
  useEffect(() => {
    if (isScanning) {
      AccessibilityInfo.announceForAccessibility("Scanning");
    }
  }, [isScanning]);

  // Start corner pulse animation on mount (respects reduced motion preference)
  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(cornerOpacity);
      cornerOpacity.value = 0.8; // Static value for reduced motion
      return;
    }

    cornerOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000 }),
        withTiming(0.6, { duration: 1000 }),
      ),
      -1,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cornerOpacity is a stable useSharedValue ref that never changes identity
  }, [reducedMotion]);

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

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const glowCornerStyle = useAnimatedStyle(() => ({
    opacity: cornerOpacity.value,
  }));

  const connectingLineStyle = useAnimatedStyle(() => ({
    opacity: cornerGlow.value,
  }));

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scanSuccessScale.value }],
    opacity: scanSuccessScale.value,
  }));

  const handlePickImage = async () => {
    // Check if user can scan today (daily limit)
    if (!canScan) {
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      setShowUpgradeModal(true);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      handleSmartScan(result.assets[0].uri);
    }
  };

  const handleShutterPress = async () => {
    // Check if user can scan today (daily limit)
    if (!canScan) {
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      setShowUpgradeModal(true);
      return;
    }

    pulseScale.value = withSequence(
      withSpring(0.9, { damping: 15 }),
      withSpring(1, { damping: 15 }),
    );
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);

    // Take a photo using the camera ref
    if (cameraRef.current) {
      try {
        // Quality is controlled by the photoQuality prop on <CameraView>
        const photo = await cameraRef.current.takePicture();

        if (photo?.uri) {
          if (isFrontLabelMode && verifyBarcode) {
            const ocrResult = cameraRef.current?.getLatestOCRResult?.();
            const localOCRText = ocrResult?.resultText ?? undefined;
            const localData = localOCRText
              ? parseFrontLabelFromOCR(localOCRText)
              : null;

            if (localData && localData.confidence >= 0.5) {
              // Fast path: local OCR confident enough — navigate immediately,
              // AI upload runs inside FrontLabelConfirmScreen
              navigation.navigate("FrontLabelConfirm", {
                imageUri: photo.uri,
                barcode: verifyBarcode,
                sessionId: null,
                data: localData,
              });
            } else {
              // Fallback: OCR confidence too low — upload first, then navigate
              try {
                const result = await uploadFrontLabelPhoto(
                  photo.uri,
                  verifyBarcode,
                );
                navigation.navigate("FrontLabelConfirm", {
                  imageUri: photo.uri,
                  barcode: verifyBarcode,
                  sessionId: result.sessionId,
                  data: result.data,
                });
              } catch (err) {
                haptics.notification(Haptics.NotificationFeedbackType.Error);
                Alert.alert(
                  "Upload Failed",
                  err instanceof Error
                    ? err.message
                    : "Could not analyze front label. Please try again.",
                );
              }
            }
          } else if (isLabelMode) {
            // Get cached OCR result from the frame processor
            const ocrResult = cameraRef.current?.getLatestOCRResult?.();
            navigation.navigate("LabelAnalysis", {
              imageUri: photo.uri,
              barcode: verifyBarcode,
              verificationMode: !!verifyBarcode,
              verifyBarcode,
              localOCRText: ocrResult?.resultText ?? undefined,
            });
            if (!verifyBarcode) refreshScanCount();
          } else {
            handleSmartScan(photo.uri);
          }
        }
      } catch {
        // Photo capture failed - provide haptic feedback to indicate failure
        haptics.notification(Haptics.NotificationFeedbackType.Error);
      }
    }
  };

  // Handle barcode scan with premium check
  const onBarcodeScanned = (result: BarcodeResult) => {
    // Check if user can scan today (daily limit)
    if (!canScan) {
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      setShowUpgradeModal(true);
      return;
    }

    handleBarcodeScanned(result);
  };

  if (permissionLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <ActivityIndicator
          size="large"
          color={theme.success}
          accessibilityLabel="Loading camera"
        />
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.closeLink}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ThemedText style={{ color: theme.link }}>Go Back</ThemedText>
        </Pressable>
      </View>
    );
  }

  if (!permission || permission.status !== "granted") {
    return (
      <View
        style={[
          styles.container,
          styles.permissionContainer,
          { backgroundColor: theme.backgroundRoot },
        ]}
      >
        <Feather
          name="camera-off"
          size={64}
          color={theme.textSecondary}
          style={styles.permissionIcon}
        />
        <ThemedText type="h3" style={styles.permissionTitle}>
          Camera Access Required
        </ThemedText>
        <ThemedText
          type="body"
          style={[styles.permissionText, { color: theme.textSecondary }]}
        >
          OCRecipes needs camera access to scan barcodes and nutrition labels
        </ThemedText>

        {permission?.status === "denied" && !permission.canAskAgain ? (
          Platform.OS !== "web" ? (
            <Pressable
              onPress={async () => {
                try {
                  await Linking.openSettings();
                } catch {
                  // Settings couldn't be opened - user can manually navigate
                  haptics.notification(Haptics.NotificationFeedbackType.Error);
                }
              }}
              accessibilityLabel="Open device settings to enable camera"
              accessibilityRole="button"
              style={[styles.permissionButton, { backgroundColor: theme.link }]}
            >
              <ThemedText type="body" style={styles.permissionButtonText}>
                Open Settings
              </ThemedText>
            </Pressable>
          ) : (
            <ThemedText
              type="small"
              style={[styles.webNote, { color: theme.textSecondary }]}
            >
              Run in Expo Go to use this feature
            </ThemedText>
          )
        ) : (
          <Pressable
            onPress={requestPermission}
            accessibilityLabel="Enable camera access"
            accessibilityRole="button"
            style={[styles.permissionButton, { backgroundColor: theme.link }]}
          >
            <ThemedText type="body" style={styles.permissionButtonText}>
              Enable Camera
            </ThemedText>
          </Pressable>
        )}
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.closeLink}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ThemedText style={{ color: theme.link }}>Go Back</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        barcodeTypes={
          isLabelMode || isFrontLabelMode ? [] : availableBarcodeTypes
        }
        onBarcodeScanned={
          isLabelMode || isFrontLabelMode ? undefined : onBarcodeScanned
        }
        enableTorch={torch}
        facing="back"
        isActive={isFocused}
        enableOCR={isLabelMode || isFrontLabelMode}
        onTextDetected={isLabelMode ? handleTextDetected : undefined}
        photoQuality={
          isLabelMode || isFrontLabelMode
            ? 0.85
            : highQualityCapture
              ? 0.9
              : 0.5
        }
      />

      <View style={[styles.overlay, { paddingTop: insets.top + Spacing.md }]}>
        <View style={styles.topControls}>
          <Pressable
            onPress={() => setTorch(!torch)}
            accessibilityLabel={
              torch ? "Turn off flashlight" : "Turn on flashlight"
            }
            accessibilityRole="button"
            accessibilityState={{ checked: torch }}
            style={[
              styles.controlButton,
              {
                backgroundColor: torch
                  ? theme.success
                  : CameraColors.overlayLight,
              },
            ]}
          >
            <Feather
              name={torch ? "zap" : "zap-off"}
              size={24}
              color={theme.buttonText}
            />
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityLabel="Close camera"
            accessibilityRole="button"
            style={[
              styles.controlButton,
              { backgroundColor: CameraColors.overlayLight },
            ]}
          >
            <Feather name="x" size={24} color={theme.buttonText} />
          </Pressable>
        </View>

        <View style={styles.reticleContainer}>
          <AnimatedView
            style={[
              styles.reticle,
              glowCornerStyle,
              { width: frame.WIDTH, height: frame.HEIGHT },
            ]}
          >
            <View
              style={[
                styles.corner,
                styles.cornerTL,
                {
                  borderColor: theme.success,
                  width: frame.CORNER_SIZE,
                  height: frame.CORNER_SIZE,
                  borderTopLeftRadius: frame.CORNER_RADIUS,
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerTR,
                {
                  borderColor: theme.success,
                  width: frame.CORNER_SIZE,
                  height: frame.CORNER_SIZE,
                  borderTopRightRadius: frame.CORNER_RADIUS,
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerBL,
                {
                  borderColor: theme.success,
                  width: frame.CORNER_SIZE,
                  height: frame.CORNER_SIZE,
                  borderBottomLeftRadius: frame.CORNER_RADIUS,
                },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerBR,
                {
                  borderColor: theme.success,
                  width: frame.CORNER_SIZE,
                  height: frame.CORNER_SIZE,
                  borderBottomRightRadius: frame.CORNER_RADIUS,
                },
              ]}
            />
          </AnimatedView>

          {/* Glow border — independent of pulse, fades in when text detected */}
          <Animated.View
            style={[
              styles.glowBorder,
              {
                width: frame.WIDTH,
                height: frame.HEIGHT,
                borderColor: theme.success,
                borderRadius: frame.CORNER_RADIUS,
              },
              connectingLineStyle,
            ]}
          />

          {/* Green flash overlay on successful barcode scan */}
          <Animated.View
            style={[
              styles.scanFlashOverlay,
              {
                width: frame.WIDTH,
                height: frame.HEIGHT,
                backgroundColor: theme.success,
                borderRadius: frame.CORNER_RADIUS,
              },
              scanFlashStyle,
            ]}
            pointerEvents="none"
          />

          <AnimatedView
            style={[
              styles.successPulse,
              successStyle,
              { backgroundColor: theme.success },
            ]}
          />

          <View accessibilityLiveRegion="polite">
            <ThemedText type="body" style={styles.reticleText} maxScale={1.3}>
              {isScanning
                ? "Scanning..."
                : isFrontLabelMode
                  ? "Position the front of the package in the frame"
                  : isLabelMode
                    ? "Align nutrition label within the frame"
                    : "Scan barcode or tap shutter for food photo"}
            </ThemedText>
          </View>

          {/* Show remaining scans for free users */}
          {!isPremium && remainingScans !== null && (
            <ThemedText type="small" style={styles.scanLimitText}>
              {remainingScans > 0
                ? `${remainingScans} scans remaining today`
                : "Daily scan limit reached"}
            </ThemedText>
          )}
        </View>

        <View
          style={[
            styles.bottomControls,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
        >
          <Pressable
            onPress={handlePickImage}
            accessibilityLabel="Choose photo from gallery"
            accessibilityRole="button"
            style={styles.galleryButton}
          >
            <Feather name="image" size={28} color={theme.buttonText} />
          </Pressable>

          <AnimatedView style={pulseStyle}>
            <Pressable
              onPress={handleShutterPress}
              accessibilityLabel="Take photo of food"
              accessibilityRole="button"
              style={[styles.shutterButton, { backgroundColor: theme.success }]}
            >
              <View style={styles.shutterInner} />
            </Pressable>
          </AnimatedView>

          <View style={styles.spacer} />
        </View>
      </View>

      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />

      {/* Smart Scan Classification Overlay */}
      <ClassificationOverlay
        classifyState={classifyState}
        classifyResult={classifyResult}
        onConfirm={handleConfirm}
        onDismiss={handleDismiss}
        onRetake={handleRetake}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CameraColors.background, // camera token
  },
  permissionContainer: {
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  permissionIcon: {
    marginBottom: Spacing["2xl"],
  },
  permissionTitle: {
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  permissionText: {
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  permissionButton: {
    height: Spacing.buttonHeight,
    paddingHorizontal: Spacing["3xl"],
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  permissionButtonText: {
    color: CameraColors.text, // camera token
    fontWeight: "600",
  },
  closeLink: {
    marginTop: Spacing.lg,
    padding: Spacing.sm,
  },
  webNote: {
    textAlign: "center",
    fontStyle: "italic",
  },
  overlay: {
    flex: 1,
    justifyContent: "space-between",
  },
  topControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  reticleContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    position: "relative",
  },
  corner: {
    position: "absolute",
    borderWidth: RETICLE.CORNER_BORDER_WIDTH,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderBottomWidth: 0,
    borderRightWidth: 0,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
  },
  glowBorder: {
    position: "absolute",
    borderWidth: 2,
  },
  scanFlashOverlay: {
    position: "absolute",
  },
  successPulse: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  reticleText: {
    color: CameraColors.text, // camera token
    marginTop: Spacing["2xl"],
    textShadowColor: CameraColors.textShadow, // camera token
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scanLimitText: {
    color: CameraColors.text, // camera token
    marginTop: Spacing.sm,
    opacity: 0.8,
    textShadowColor: CameraColors.textShadow, // camera token
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  bottomControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing["3xl"],
  },
  galleryButton: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.full,
    backgroundColor: CameraColors.overlayLight, // camera token
    justifyContent: "center",
    alignItems: "center",
  },
  shutterButton: {
    width: Spacing.shutterButtonSize,
    height: Spacing.shutterButtonSize,
    borderRadius: Spacing.shutterButtonSize / 2,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000", // hardcoded — shadow color is always black
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CameraColors.shutterButton, // camera token
  },
  spacer: {
    width: 56,
    height: 56,
  },
});
