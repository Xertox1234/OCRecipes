import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Platform,
  Linking,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import {
  useNavigation,
  useIsFocused,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { Spacing, BorderRadius, CameraColors } from "@/constants/theme";
import { CameraView, useCameraPermissions, type CameraRef } from "@/camera";
import { useCreateCookSession, useAddCookPhoto } from "@/hooks/useCookSession";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const MAX_PHOTOS = 10;

export default function CookSessionCaptureScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const { confirm, ConfirmationModal } = useConfirmationModal();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "CookSessionCapture">>();
  const isFocused = useIsFocused();

  const {
    permission,
    isLoading: permissionLoading,
    requestPermission,
  } = useCameraPermissions();

  const cameraRef = useRef<CameraRef>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ingredientCount, setIngredientCount] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Promise memoization for session creation
  const sessionPromiseRef = useRef<Promise<string> | null>(null);

  const createSession = useCreateCookSession();
  const addPhoto = useAddCookPhoto();

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    if (sessionPromiseRef.current) return sessionPromiseRef.current;

    sessionPromiseRef.current = createSession
      .mutateAsync()
      .then((res) => {
        setSessionId(res.id);
        return res.id;
      })
      .catch((err) => {
        sessionPromiseRef.current = null;
        throw err;
      });

    return sessionPromiseRef.current;
  }, [sessionId, createSession]);

  // Handle initial photo from PhotoIntentScreen
  useEffect(() => {
    if (route.params?.initialPhotoUri) {
      handleAnalyzePhoto(route.params.initialPhotoUri);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnalyzePhoto = useCallback(
    async (photoUri: string) => {
      setIsAnalyzing(true);
      try {
        const sid = await ensureSession();
        // sessionId state update is async — thread `sid` directly into
        // the mutation variables so we don't depend on a re-render.
        // (H12 — 2026-04-18.)
        setSessionId(sid);

        const result = await addPhoto.mutateAsync({
          sessionId: sid,
          photoUri,
        });
        haptics.notification(Haptics.NotificationFeedbackType.Success);
        setIngredientCount(result.ingredients.length);
        setPhotos((prev) => [...prev, photoUri]);
      } catch {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        toast.error("Could not analyze this photo. Please try again.");
      } finally {
        setIsAnalyzing(false);
      }
    },
    [ensureSession, addPhoto, haptics, toast],
  );

  const handleCapture = useCallback(async () => {
    if (isCapturing || photos.length >= MAX_PHOTOS || isAnalyzing) return;
    setIsCapturing(true);

    try {
      if (!cameraRef.current) return;
      const photo = await cameraRef.current.takePicture({
        quality: 0.85,
        skipProcessing: Platform.OS === "android",
      });
      if (photo?.uri) {
        haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
        handleAnalyzePhoto(photo.uri);
      }
    } catch (error) {
      console.error("Capture error:", error);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, photos.length, isAnalyzing, haptics, handleAnalyzePhoto]);

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
      for (const asset of result.assets) {
        await handleAnalyzePhoto(asset.uri);
      }
    }
  }, [photos.length, handleAnalyzePhoto]);

  const handleDone = useCallback(() => {
    if (!sessionId || ingredientCount === 0) {
      Alert.alert(
        "No Ingredients",
        "Take at least one photo to detect ingredients.",
      );
      return;
    }

    // Navigate to review
    navigation.replace("CookSessionReview", {
      sessionId,
      ingredients: [], // Will be fetched by the review screen
    });
  }, [sessionId, ingredientCount, navigation]);

  const handleClose = useCallback(() => {
    if (ingredientCount > 0) {
      confirm({
        title: "Discard Session?",
        message: "Your detected ingredients will be lost.",
        confirmLabel: "Discard",
        destructive: true,
        onConfirm: () => navigation.goBack(),
      });
    } else {
      navigation.goBack();
    }
  }, [ingredientCount, navigation, confirm]);

  // Permission states
  if (permissionLoading) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <ActivityIndicator size="large" color={theme.success} />
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
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <View style={styles.permissionContent}>
          <Feather name="camera-off" size={48} color={theme.textSecondary} />
          <ThemedText type="h2" style={styles.permissionTitle}>
            Camera Access Required
          </ThemedText>
          <ThemedText
            type="body"
            style={[styles.permissionText, { color: theme.textSecondary }]}
          >
            Allow camera access to photograph your ingredients.
          </ThemedText>
          <Pressable
            style={[
              styles.permissionButton,
              { backgroundColor: theme.success },
            ]}
            onPress={() => {
              if (permission?.canAskAgain) {
                requestPermission();
              } else {
                Linking.openSettings();
              }
            }}
            accessibilityLabel="Grant camera permission"
            accessibilityRole="button"
          >
            <ThemedText
              type="body"
              style={{ color: CameraColors.text, fontWeight: "600" }}
            >
              {permission?.status === "denied" && !permission.canAskAgain
                ? "Open Settings"
                : "Grant Permission"}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.closeLink}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ThemedText style={{ color: theme.link }}>Go Back</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: CameraColors.background }]}
    >
      {/* Camera */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        isActive={isFocused}
        barcodeTypes={[]}
      />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={handleClose}
          style={styles.topButton}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Feather name="x" size={24} color={CameraColors.text} />
        </Pressable>

        <View style={styles.topCenter}>
          {ingredientCount > 0 && (
            <View
              style={[
                styles.ingredientBadge,
                { backgroundColor: theme.success },
              ]}
            >
              <Feather name="check" size={14} color={CameraColors.text} />
              <ThemedText
                type="small"
                style={{ color: CameraColors.text, fontWeight: "600" }}
              >
                {ingredientCount} ingredient{ingredientCount !== 1 ? "s" : ""}
              </ThemedText>
            </View>
          )}
        </View>

        <Pressable
          onPress={handlePickFromGallery}
          style={styles.topButton}
          accessibilityLabel="Pick from gallery"
          accessibilityRole="button"
        >
          <Feather name="image" size={24} color={CameraColors.text} />
        </Pressable>
      </View>

      {/* Analyzing overlay */}
      {isAnalyzing && (
        <View style={styles.analyzingOverlay}>
          <ActivityIndicator size="large" color={CameraColors.text} />
          <ThemedText type="body" style={styles.analyzingText}>
            Detecting ingredients...
          </ThemedText>
        </View>
      )}

      {/* Photo thumbnails */}
      {photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.thumbnailStrip, { bottom: 140 + insets.bottom }]}
          contentContainerStyle={styles.thumbnailContent}
        >
          {photos.map((uri, index) => (
            <Image
              key={index}
              source={{ uri }}
              style={styles.thumbnailImage}
              accessibilityLabel={`Ingredient photo ${index + 1}`}
            />
          ))}
        </ScrollView>
      )}

      {/* Bottom controls */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
      >
        <View style={styles.bottomControls}>
          {/* Photo count */}
          <ThemedText type="small" style={styles.photoCount}>
            {photos.length}/{MAX_PHOTOS}
          </ThemedText>

          {/* Shutter button */}
          <Pressable
            onPress={handleCapture}
            disabled={isCapturing || isAnalyzing || photos.length >= MAX_PHOTOS}
            style={[
              styles.shutterButton,
              (isCapturing || isAnalyzing) && styles.shutterDisabled,
            ]}
            accessibilityLabel="Take photo"
            accessibilityRole="button"
          >
            <View style={styles.shutterInner} />
          </Pressable>

          {/* Done button */}
          <Pressable
            onPress={handleDone}
            disabled={ingredientCount === 0 || isAnalyzing}
            style={[
              styles.doneButton,
              { backgroundColor: theme.success },
              (ingredientCount === 0 || isAnalyzing) && { opacity: 0.5 },
            ]}
            accessibilityLabel="Done, review ingredients"
            accessibilityRole="button"
          >
            <ThemedText
              type="body"
              style={{ color: CameraColors.text, fontWeight: "600" }}
            >
              Done
            </ThemedText>
          </Pressable>
        </View>
      </View>
      <ConfirmationModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
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
  topCenter: {
    flex: 1,
    alignItems: "center",
  },
  ingredientBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  analyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: CameraColors.overlayMediumDark,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 5,
  },
  analyzingText: {
    color: CameraColors.text,
    marginTop: Spacing.md,
  },
  thumbnailStrip: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 64,
  },
  thumbnailContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  thumbnailImage: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)", // hardcoded
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: Spacing.lg,
    backgroundColor: CameraColors.overlayMedium,
  },
  bottomControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: Spacing.xl,
  },
  photoCount: {
    color: "rgba(255,255,255,0.7)", // hardcoded
    width: 60,
    textAlign: "center",
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: CameraColors.text,
    justifyContent: "center",
    alignItems: "center",
  },
  shutterDisabled: {
    opacity: 0.5,
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CameraColors.text,
  },
  doneButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    minWidth: 60,
    alignItems: "center",
  },
  permissionContent: {
    alignItems: "center",
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  permissionTitle: {
    marginTop: Spacing.md,
  },
  permissionText: {
    textAlign: "center",
    maxWidth: 280,
  },
  permissionButton: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  closeLink: {
    marginTop: Spacing.lg,
    padding: Spacing.sm,
  },
});
