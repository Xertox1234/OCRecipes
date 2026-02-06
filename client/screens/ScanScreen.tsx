import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Platform,
  Linking,
  ActivityIndicator,
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
import { useNavigation, useIsFocused } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { ScanScreenNavigationProp } from "@/types/navigation";

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

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<ScanScreenNavigationProp>();
  const isFocused = useIsFocused();
  const {
    permission,
    isLoading: permissionLoading,
    requestPermission,
  } = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const haptics = useHaptics();

  // Timeout refs for cleanup
  const navigationTimeoutRef = useRef<TimeoutRef>(null);
  const resetTimeoutRef = useRef<TimeoutRef>(null);

  // Premium features
  const { availableBarcodeTypes, canScan, remainingScans, isPremium } =
    usePremiumCamera();
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
    };
  }, []);

  const pulseScale = useSharedValue(1);
  const cornerOpacity = useSharedValue(0.6);
  const scanSuccessScale = useSharedValue(0);

  // Start corner pulse animation on mount (respects reduced motion preference)
  // Note: cornerOpacity is a stable useSharedValue ref, safe to omit from deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handlePickImage = async () => {
    // Check if user can scan today (daily limit)
    if (!canScan) {
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      // TODO: Show upgrade modal
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      navigation.navigate("PhotoIntent", {
        imageUri: result.assets[0].uri,
      });
      refreshScanCount();
    }
  };

  const handleShutterPress = async () => {
    // Check if user can scan today (daily limit)
    if (!canScan) {
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      // TODO: Show upgrade modal
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
        const photo = await cameraRef.current.takePicture({
          quality: 1,
        });

        if (photo?.uri) {
          navigation.navigate("PhotoIntent", { imageUri: photo.uri });
          refreshScanCount();
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
      // TODO: Show upgrade modal
      return;
    }

    handleBarcodeScanned(result);
  };

  if (permissionLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <ActivityIndicator size="large" color={theme.success} />
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
          NutriScan needs camera access to scan barcodes and nutrition labels
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
              style={[
                styles.permissionButton,
                { backgroundColor: theme.success },
              ]}
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
            style={[
              styles.permissionButton,
              { backgroundColor: theme.success },
            ]}
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
        barcodeTypes={availableBarcodeTypes}
        onBarcodeScanned={onBarcodeScanned}
        enableTorch={torch}
        facing="back"
        isActive={isFocused}
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
              color="#FFFFFF"
            />
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("HistoryTab")}
            accessibilityLabel="Close camera"
            accessibilityRole="button"
            style={[
              styles.controlButton,
              { backgroundColor: "rgba(0,0,0,0.4)" },
            ]}
          >
            <Feather name="x" size={24} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.reticleContainer}>
          <AnimatedView style={[styles.reticle, cornerStyle]}>
            <View
              style={[
                styles.corner,
                styles.cornerTL,
                { borderColor: theme.success },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerTR,
                { borderColor: theme.success },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerBL,
                { borderColor: theme.success },
              ]}
            />
            <View
              style={[
                styles.corner,
                styles.cornerBR,
                { borderColor: theme.success },
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

          <ThemedText type="body" style={styles.reticleText}>
            {isScanning
              ? "Scanning..."
              : "Scan barcode or tap shutter for food photo"}
          </ThemedText>

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
            <Feather name="image" size={28} color="#FFFFFF" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
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
    color: "#FFFFFF",
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
    width: RETICLE.WIDTH,
    height: RETICLE.HEIGHT,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: RETICLE.CORNER_SIZE,
    height: RETICLE.CORNER_SIZE,
    borderWidth: RETICLE.CORNER_BORDER_WIDTH,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderBottomWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: RETICLE.CORNER_RADIUS,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderTopRightRadius: RETICLE.CORNER_RADIUS,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: RETICLE.CORNER_RADIUS,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomRightRadius: RETICLE.CORNER_RADIUS,
  },
  successPulse: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  reticleText: {
    color: "#FFFFFF",
    marginTop: Spacing["2xl"],
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  scanLimitText: {
    color: "#FFFFFF",
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
  },
  spacer: {
    width: 56,
    height: 56,
  },
});
