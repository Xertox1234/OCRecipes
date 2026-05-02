import React, { useState, useCallback, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Platform,
  Linking,
  Image,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useNavigation, useIsFocused } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { usePremiumContext } from "@/context/PremiumContext";
import { useReceiptScanCount } from "@/hooks/useReceiptScan";
import { Spacing, BorderRadius, CameraColors } from "@/constants/theme";
import {
  CameraView,
  useCameraPermissions,
  recognizeTextFromPhoto,
  type CameraRef,
} from "@/camera";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const MAX_PHOTOS = 3;

export default function ReceiptCaptureScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  const { isPremium } = usePremiumContext();
  const { data: scanCount } = useReceiptScanCount(isPremium);

  const {
    permission,
    isLoading: permissionLoading,
    requestPermission,
  } = useCameraPermissions();

  const cameraRef = useRef<CameraRef>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [ocrTexts, setOcrTexts] = useState<(string | undefined)[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);

  // Premium gate on mount
  const shouldShowUpgrade = !isPremium;

  const handleCapture = useCallback(async () => {
    if (isCapturing || photos.length >= MAX_PHOTOS) return;
    setIsCapturing(true);

    try {
      if (!cameraRef.current) return;
      const photo = await cameraRef.current.takePicture({
        quality: 0.85,
        skipProcessing: Platform.OS === "android",
      });
      if (photo?.uri) {
        const ocrResult = await recognizeTextFromPhoto(photo.uri);
        haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
        setPhotos((prev) => [...prev, photo.uri]);
        setOcrTexts((prev) => [...prev, ocrResult.text || undefined]);
      }
    } catch (error) {
      console.error("Capture error:", error);
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, photos.length, haptics]);

  const handlePickFromGallery = useCallback(async () => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });

    if (!result.canceled && result.assets.length > 0) {
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      const galleryUris = result.assets.map((a) => a.uri).slice(0, remaining);
      setPhotos((prev) => [...prev, ...galleryUris]);
      // Gallery photos have no frame-processor OCR available
      setOcrTexts((prev) => [...prev, ...galleryUris.map(() => undefined)]);
    }
  }, [photos.length, haptics]);

  const handleRemovePhoto = useCallback(
    (index: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setPhotos((prev) => prev.filter((_, i) => i !== index));
      setOcrTexts((prev) => prev.filter((_, i) => i !== index));
    },
    [haptics],
  );

  const handleDone = useCallback(() => {
    if (photos.length === 0) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    const definedOcrTexts = ocrTexts.filter(
      (t): t is string => typeof t === "string",
    );
    navigation.replace("ReceiptReview", {
      photoUris: photos,
      ocrTexts: definedOcrTexts.length > 0 ? definedOcrTexts : undefined,
    });
  }, [photos, ocrTexts, haptics, navigation]);

  // Permission states
  if (permissionLoading) {
    return (
      <View
        style={[styles.centered, { backgroundColor: theme.backgroundDefault }]}
      >
        <ActivityIndicator size="large" color={theme.link} />
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backLink}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ThemedText style={{ color: theme.link }}>Go Back</ThemedText>
        </Pressable>
      </View>
    );
  }

  if (permission?.status !== "granted") {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
        ]}
      >
        <Feather name="camera-off" size={48} color={theme.textSecondary} />
        <ThemedText
          style={[styles.permissionText, { color: theme.textSecondary }]}
        >
          Camera permission is required to scan receipts
        </ThemedText>
        <Pressable
          onPress={() => {
            if (permission?.canAskAgain) {
              requestPermission();
            } else {
              Linking.openSettings();
            }
          }}
          style={[styles.permissionButton, { backgroundColor: theme.link }]}
          accessibilityRole="button"
          accessibilityLabel={
            permission?.canAskAgain
              ? "Grant camera permission"
              : "Open settings"
          }
        >
          <ThemedText
            style={[styles.permissionButtonText, { color: theme.buttonText }]}
          >
            {permission?.canAskAgain ? "Grant Permission" : "Open Settings"}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backLink}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ThemedText style={{ color: theme.link }}>Go Back</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: CameraColors.background }]}
      accessibilityViewIsModal
    >
      {/* Upgrade modal for free users */}
      {shouldShowUpgrade && (
        <UpgradeModal visible={true} onClose={() => navigation.goBack()} />
      )}

      {/* Camera */}
      {isFocused && !shouldShowUpgrade && (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeTypes={[]}
          isActive={isFocused}
        />
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.topButton}
        >
          <Feather name="x" size={24} color={CameraColors.text} />
        </Pressable>

        <ThemedText style={styles.topTitle}>Scan Receipt</ThemedText>

        {scanCount && (
          <View style={styles.scanCounter}>
            <ThemedText style={styles.scanCountText}>
              {scanCount.remaining} left
            </ThemedText>
          </View>
        )}
      </View>

      {/* Photo thumbnails strip */}
      {photos.length > 0 && (
        <View style={[styles.thumbnailStrip, { bottom: 160 + insets.bottom }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {photos.map((uri, index) => (
              <View key={uri} style={styles.thumbnailWrapper}>
                <Image
                  source={{ uri }}
                  style={styles.thumbnail}
                  accessibilityLabel={`Receipt photo ${index + 1} of ${photos.length}`}
                />
                <Pressable
                  onPress={() => handleRemovePhoto(index)}
                  style={styles.removeBadge}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1}`}
                >
                  <Feather name="x" size={14} color={CameraColors.text} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Bottom controls */}
      <View
        style={[
          styles.bottomControls,
          { paddingBottom: insets.bottom + Spacing.md },
        ]}
      >
        {/* Gallery picker */}
        <Pressable
          onPress={handlePickFromGallery}
          style={styles.sideButton}
          accessibilityRole="button"
          accessibilityLabel="Pick from gallery"
          disabled={photos.length >= MAX_PHOTOS}
        >
          <Feather
            name="image"
            size={24}
            color={
              photos.length >= MAX_PHOTOS
                ? CameraColors.iconDisabled
                : CameraColors.text
            }
          />
        </Pressable>

        {/* Capture / Done */}
        {photos.length > 0 ? (
          <View style={styles.centerButtons}>
            {photos.length < MAX_PHOTOS && (
              <Pressable
                onPress={handleCapture}
                disabled={isCapturing}
                style={[styles.captureButton, styles.smallCapture]}
                accessibilityRole="button"
                accessibilityLabel="Take another photo"
              >
                {isCapturing ? (
                  <ActivityIndicator
                    size="small"
                    color={CameraColors.iconOnLight}
                  />
                ) : (
                  <Feather
                    name="camera"
                    size={20}
                    color={CameraColors.iconOnLight}
                  />
                )}
              </Pressable>
            )}
            <Pressable
              onPress={handleDone}
              style={[styles.doneButton, { backgroundColor: theme.link }]}
              accessibilityRole="button"
              accessibilityLabel={`Done with ${photos.length} photo${photos.length > 1 ? "s" : ""}`}
            >
              <ThemedText
                style={[styles.doneText, { color: theme.buttonText }]}
              >
                Done ({photos.length})
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={handleCapture}
            disabled={isCapturing}
            style={styles.captureButton}
            accessibilityRole="button"
            accessibilityLabel="Take photo of receipt"
          >
            {isCapturing ? (
              <ActivityIndicator
                size="small"
                color={CameraColors.iconOnLight}
              />
            ) : (
              <View style={styles.captureInner} />
            )}
          </Pressable>
        )}

        {/* Photo count */}
        <View style={styles.sideButton}>
          <ThemedText style={styles.photoCount}>
            {photos.length}/{MAX_PHOTOS}
          </ThemedText>
        </View>
      </View>

      {/* Hint text */}
      <View style={[styles.hintContainer, { bottom: 100 + insets.bottom }]}>
        <ThemedText style={styles.hintText}>
          {photos.length === 0
            ? "Take a photo of your receipt"
            : photos.length < MAX_PHOTOS
              ? "Add another photo or tap Done"
              : "Tap Done to continue"}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  permissionText: {
    fontSize: 16,
    textAlign: "center",
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  permissionButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  permissionButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  backLink: {
    marginTop: Spacing.lg,
    padding: Spacing.sm,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    zIndex: 10,
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CameraColors.overlayLight,
    justifyContent: "center",
    alignItems: "center",
  },
  topTitle: {
    color: CameraColors.text,
    fontSize: 17,
    fontWeight: "600",
    backgroundColor: CameraColors.overlayLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  scanCounter: {
    backgroundColor: CameraColors.overlayMedium,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  scanCountText: {
    color: CameraColors.text,
    fontSize: 13,
  },
  thumbnailStrip: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 10,
  },
  thumbnailWrapper: {
    marginRight: Spacing.sm,
    position: "relative",
  },
  thumbnail: {
    width: 60,
    height: 80,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    borderColor: CameraColors.text,
  },
  removeBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: CameraColors.overlayDark,
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  bottomControls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    backgroundColor: CameraColors.overlayLight,
  },
  sideButton: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: CameraColors.text,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.5)",
  },
  captureInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: CameraColors.text,
  },
  smallCapture: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    marginRight: Spacing.md,
  },
  centerButtons: {
    flexDirection: "row",
    alignItems: "center",
  },
  doneButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  doneText: {
    fontSize: 16,
    fontWeight: "700",
  },
  photoCount: {
    color: CameraColors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  hintContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  hintText: {
    color: CameraColors.text,
    fontSize: 14,
    backgroundColor: CameraColors.overlayMedium,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
});
