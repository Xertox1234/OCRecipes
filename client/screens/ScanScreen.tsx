import React, { useState, useEffect, useRef } from "react";
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
} from "react-native-reanimated";
import {
  useNavigation,
  useIsFocused,
  useRoute,
  RouteProp,
} from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius } from "@/constants/theme";
import { UpgradeModal } from "@/components/UpgradeModal";
import type { ScanScreenNavigationProp } from "@/types/navigation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  uploadPhotoForAnalysis,
  uploadFrontLabelPhoto,
  type PhotoAnalysisResponse,
} from "@/lib/photo-upload";
import {
  getRouteForContentType,
  shouldAutoRoute,
  getConfirmationMessage,
  getContentTypeLabel,
  getPremiumGate,
} from "./scan-screen-utils";
import type { ContentType } from "@shared/constants/classification";

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

/** Timeout ref type for cleanup */
type TimeoutRef = ReturnType<typeof setTimeout> | null;

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

  // Smart scan classification state
  type ClassifyState =
    | "idle"
    | "classifying"
    | "classified"
    | "confirming"
    | "error";
  const [classifyState, setClassifyState] = useState<ClassifyState>("idle");
  const [classifyResult, setClassifyResult] =
    useState<PhotoAnalysisResponse | null>(null);
  const [classifyImageUri, setClassifyImageUri] = useState<string | null>(null);
  const isClassifyingRef = useRef(false);
  const classifyTimeoutRef = useRef<TimeoutRef>(null);
  const autoRouteTimeoutRef = useRef<TimeoutRef>(null);

  // Timeout refs for cleanup
  const navigationTimeoutRef = useRef<TimeoutRef>(null);
  const resetTimeoutRef = useRef<TimeoutRef>(null);

  // Premium features
  const {
    availableBarcodeTypes,
    canScan,
    remainingScans,
    isPremium,
    highQualityCapture,
  } = usePremiumCamera();
  const { refreshScanCount } = usePremiumContext();

  // Camera hook with debouncing
  const { cameraRef, isScanning, handleBarcodeScanned, resetScanning } =
    useCamera({
      onBarcodeScanned: async (result: BarcodeResult) => {
        haptics.notification(Haptics.NotificationFeedbackType.Success);

        scanSuccessScale.value = withSequence(
          withSpring(1.2, { damping: 10 }),
          withSpring(1, { damping: 15 }),
        );

        // Navigate after brief delay for animation (with cleanup tracking)
        navigationTimeoutRef.current = setTimeout(() => {
          navigation.navigate("NutritionDetail", { barcode: result.data });
          // Refresh scan count after navigation
          refreshScanCount();
          resetTimeoutRef.current = setTimeout(() => {
            resetScanning();
            scanSuccessScale.value = 0;
          }, SCAN_TIMING.RESET_DELAY_MS);
        }, SCAN_TIMING.NAVIGATION_DELAY_MS);
      },
      debounceMs: SCAN_TIMING.SCAN_DEBOUNCE_MS,
    });

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current)
        clearTimeout(navigationTimeoutRef.current);
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
      if (classifyTimeoutRef.current) clearTimeout(classifyTimeoutRef.current);
      if (autoRouteTimeoutRef.current)
        clearTimeout(autoRouteTimeoutRef.current);
    };
  }, []);

  // Announce scanning state changes for iOS (accessibilityLiveRegion is Android-only)
  useEffect(() => {
    if (isScanning) {
      AccessibilityInfo.announceForAccessibility("Scanning");
    }
  }, [isScanning]);

  const pulseScale = useSharedValue(1);
  const cornerOpacity = useSharedValue(0.6);
  const scanSuccessScale = useSharedValue(0);

  // Start corner pulse animation on mount (respects reduced motion preference)
  useEffect(() => {
    if (reducedMotion) {
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

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const cornerStyle = useAnimatedStyle(() => ({
    opacity: cornerOpacity.value,
  }));

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scanSuccessScale.value }],
    opacity: scanSuccessScale.value,
  }));

  /** Navigate to the appropriate screen based on classification result */
  const routeFromClassification = (
    result: PhotoAnalysisResponse,
    imageUri: string,
  ) => {
    const contentType = result.contentType as ContentType | undefined;
    if (!contentType) {
      // Fallback: if no contentType, treat as standard analysis result
      navigation.navigate("PhotoAnalysis", {
        imageUri,
        intent: result.resolvedIntent ?? "log",
      });
      return;
    }

    // Check premium gating
    const gate = getPremiumGate(contentType);
    if (gate && !isPremium) {
      setClassifyState("idle");
      setShowUpgradeModal(true);
      return;
    }

    const resolvedIntent = result.resolvedIntent ?? null;
    const barcode = result.barcode ?? null;

    switch (contentType) {
      case "prepared_meal":
        navigation.navigate("PhotoAnalysis", {
          imageUri,
          intent: resolvedIntent ?? "log",
        });
        break;
      case "nutrition_label":
        navigation.navigate("LabelAnalysis", { imageUri });
        break;
      case "restaurant_menu":
        navigation.navigate("PhotoAnalysis", { imageUri, intent: "menu" });
        break;
      case "raw_ingredients":
        navigation.navigate("CookSessionCapture", {
          initialPhotoUri: imageUri,
        });
        break;
      case "grocery_receipt":
      case "restaurant_receipt":
        navigation.navigate("ReceiptCapture");
        break;
      case "has_barcode":
        if (barcode) {
          navigation.navigate("NutritionDetail", { barcode });
        } else {
          setClassifyState("error");
        }
        return;
      case "non_food":
      default:
        setClassifyState("error");
        return;
    }
  };

  /** Run smart scan classification on a photo */
  const handleSmartScan = async (imageUri: string) => {
    if (isClassifyingRef.current) return;
    isClassifyingRef.current = true;
    setClassifyState("classifying");
    setClassifyImageUri(imageUri);

    // 10-second timeout → fallback to PhotoIntentScreen
    classifyTimeoutRef.current = setTimeout(() => {
      if (isClassifyingRef.current) {
        isClassifyingRef.current = false;
        setClassifyState("idle");
        navigation.navigate("PhotoIntent", { imageUri });
      }
    }, 10000);

    try {
      const result = await uploadPhotoForAnalysis(imageUri, "auto");
      // Clear timeout since we got a response
      if (classifyTimeoutRef.current) {
        clearTimeout(classifyTimeoutRef.current);
        classifyTimeoutRef.current = null;
      }

      // Guard against race condition: if the 10s timeout already fired
      // and navigated to PhotoIntentScreen, bail out to prevent double navigation
      if (!isClassifyingRef.current) return;

      setClassifyResult(result);
      refreshScanCount();

      if (result.contentType && shouldAutoRoute(result.confidence ?? 0)) {
        // High confidence → brief "Detected" state, then auto-route
        setClassifyState("classified");

        if (Platform.OS === "ios") {
          AccessibilityInfo.announceForAccessibility(
            `Detected: ${getContentTypeLabel(result.contentType as ContentType)}. Navigating to results.`,
          );
        }

        autoRouteTimeoutRef.current = setTimeout(() => {
          isClassifyingRef.current = false;
          setClassifyState("idle");
          routeFromClassification(result, imageUri);
        }, 1500);
      } else if (result.contentType) {
        // Low confidence → show confirmation
        setClassifyState("confirming");
        if (Platform.OS === "ios") {
          AccessibilityInfo.announceForAccessibility(
            getConfirmationMessage(result.contentType as ContentType),
          );
        }
      } else {
        // No contentType in response — fallback
        isClassifyingRef.current = false;
        setClassifyState("idle");
        navigation.navigate("PhotoIntent", { imageUri });
      }
    } catch {
      if (classifyTimeoutRef.current) {
        clearTimeout(classifyTimeoutRef.current);
      }
      isClassifyingRef.current = false;
      setClassifyState("idle");
      // Error → fallback to PhotoIntentScreen
      navigation.navigate("PhotoIntent", { imageUri });
    }
  };

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
            // Front-label mode: upload photo, get extraction, navigate to confirm
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
          } else if (isLabelMode) {
            navigation.navigate("LabelAnalysis", {
              imageUri: photo.uri,
              barcode: verifyBarcode,
              verificationMode: !!verifyBarcode,
              verifyBarcode,
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
                backgroundColor: torch ? theme.success : "rgba(0,0,0,0.4)",
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
              { backgroundColor: "rgba(0,0,0,0.4)" },
            ]}
          >
            <Feather name="x" size={24} color={theme.buttonText} />
          </Pressable>
        </View>

        <View style={styles.reticleContainer}>
          <AnimatedView
            style={[
              styles.reticle,
              cornerStyle,
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

          <AnimatedView
            style={[
              styles.successPulse,
              successStyle,
              { backgroundColor: theme.success },
            ]}
          />

          <View accessibilityLiveRegion="polite">
            <ThemedText
              type="body"
              style={styles.reticleText}
              maxFontSizeMultiplier={1.3}
            >
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
      {classifyState !== "idle" && (
        <View
          style={styles.classificationOverlay}
          accessibilityViewIsModal={true}
        >
          {classifyState === "classifying" && (
            <View style={styles.classificationContent}>
              <ActivityIndicator
                size="large"
                color="#FFFFFF" // hardcoded — white spinner on dark overlay
                accessibilityLabel="Analyzing your photo"
              />
              <ThemedText
                type="body"
                style={styles.classificationText}
                accessibilityLiveRegion="polite"
              >
                Analyzing your photo...
              </ThemedText>
            </View>
          )}

          {classifyState === "classified" && classifyResult?.contentType && (
            <View style={styles.classificationContent}>
              <Feather name="check-circle" size={48} color={theme.success} />
              <ThemedText
                type="h3"
                style={styles.classificationText}
                accessibilityLiveRegion="polite"
              >
                {getContentTypeLabel(classifyResult.contentType as ContentType)}
              </ThemedText>
            </View>
          )}

          {classifyState === "confirming" && classifyResult?.contentType && (
            <View style={styles.classificationContent}>
              <ThemedText type="body" style={styles.classificationText}>
                {getConfirmationMessage(
                  classifyResult.contentType as ContentType,
                )}
              </ThemedText>
              <View style={styles.confirmButtons}>
                <Pressable
                  onPress={() => {
                    isClassifyingRef.current = false;
                    setClassifyState("idle");
                    if (classifyResult && classifyImageUri) {
                      routeFromClassification(classifyResult, classifyImageUri);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Yes, this is a ${getContentTypeLabel(classifyResult.contentType as ContentType).toLowerCase()}`}
                  style={[
                    styles.confirmButton,
                    { backgroundColor: theme.success },
                  ]}
                >
                  <ThemedText type="body" style={styles.confirmButtonText}>
                    Yes
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    isClassifyingRef.current = false;
                    setClassifyState("idle");
                    if (classifyImageUri) {
                      navigation.navigate("PhotoIntent", {
                        imageUri: classifyImageUri,
                      });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Show other classification options"
                  style={[
                    styles.confirmButton,
                    {
                      backgroundColor: "transparent",
                      borderWidth: 1,
                      borderColor: "#FFFFFF", // hardcoded — white border on dark overlay
                    },
                  ]}
                >
                  <ThemedText type="body" style={styles.confirmButtonText}>
                    Other options
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          )}

          {classifyState === "error" && (
            <View style={styles.classificationContent}>
              <Feather name="alert-circle" size={48} color={theme.error} />
              <ThemedText
                type="body"
                style={styles.classificationText}
                accessibilityRole="alert"
              >
                {"We couldn't identify food in this photo."}
              </ThemedText>
              <View style={styles.confirmButtons}>
                <Pressable
                  onPress={() => {
                    isClassifyingRef.current = false;
                    setClassifyState("idle");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Retake photo"
                  style={[
                    styles.confirmButton,
                    { backgroundColor: theme.link },
                  ]}
                >
                  <ThemedText type="body" style={styles.confirmButtonText}>
                    Retake
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    isClassifyingRef.current = false;
                    setClassifyState("idle");
                    if (classifyImageUri) {
                      navigation.navigate("PhotoIntent", {
                        imageUri: classifyImageUri,
                      });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Choose food manually from search"
                  style={[
                    styles.confirmButton,
                    {
                      backgroundColor: "transparent",
                      borderWidth: 1,
                      borderColor: "#FFFFFF", // hardcoded — white border on dark overlay
                    },
                  ]}
                >
                  <ThemedText type="body" style={styles.confirmButtonText}>
                    Choose manually
                  </ThemedText>
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
  container: {
    flex: 1,
    backgroundColor: "#000", // hardcoded — camera background must be black
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
    color: "#FFFFFF", // hardcoded — white text on colored button
    fontWeight: "600",
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
  successPulse: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  reticleText: {
    color: "#FFFFFF", // hardcoded — white text over camera feed
    marginTop: Spacing["2xl"],
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scanLimitText: {
    color: "#FFFFFF", // hardcoded — white text over camera feed
    marginTop: Spacing.sm,
    opacity: 0.8,
    textShadowColor: "rgba(0,0,0,0.5)",
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
    backgroundColor: "rgba(0,0,0,0.4)",
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
    backgroundColor: "#FFFFFF", // hardcoded — shutter button is always white
  },
  spacer: {
    width: 56,
    height: 56,
  },
  classificationOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)", // hardcoded — semi-transparent overlay over camera
    justifyContent: "center",
    alignItems: "center",
  },
  classificationContent: {
    alignItems: "center",
    paddingHorizontal: Spacing["2xl"],
    gap: Spacing.lg,
  },
  classificationText: {
    color: "#FFFFFF", // hardcoded — white text on dark overlay
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.3)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  confirmButton: {
    height: 48,
    minWidth: 120,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmButtonText: {
    color: "#FFFFFF", // hardcoded — white text on buttons
    fontWeight: "600",
  },
});
