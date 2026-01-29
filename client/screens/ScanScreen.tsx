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
import { CameraView, useCameraPermissions, BarcodeScanningResult } from "expo-camera";
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
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";

const AnimatedView = Animated.createAnimatedComponent(View);

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const lastScannedRef = useRef<string | null>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const pulseScale = useSharedValue(1);
  const cornerOpacity = useSharedValue(0.6);
  const scanSuccessScale = useSharedValue(0);

  useEffect(() => {
    cornerOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000 }),
        withTiming(0.6, { duration: 1000 })
      ),
      -1,
      true
    );
  }, []);

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

  const handleBarCodeScanned = (result: BarcodeScanningResult) => {
    if (isScanning) return;
    if (lastScannedRef.current === result.data) return;

    lastScannedRef.current = result.data;
    setIsScanning(true);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    scanSuccessScale.value = withSequence(
      withSpring(1.2, { damping: 10 }),
      withSpring(1, { damping: 15 })
    );

    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }

    scanTimeoutRef.current = setTimeout(() => {
      navigation.navigate("NutritionDetail", { barcode: result.data });
      setTimeout(() => {
        setIsScanning(false);
        lastScannedRef.current = null;
        scanSuccessScale.value = 0;
      }, 500);
    }, 300);
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      navigation.navigate("NutritionDetail", { imageUri: result.assets[0].uri });
    }
  };

  const handleShutterPress = () => {
    pulseScale.value = withSequence(
      withSpring(0.9, { damping: 15 }),
      withSpring(1, { damping: 15 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator size="large" color={Colors.light.success} />
      </View>
    );
  }

  if (!permission.granted) {
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

        {permission.status === "denied" && !permission.canAskAgain ? (
          Platform.OS !== "web" ? (
            <Pressable
              onPress={async () => {
                try {
                  await Linking.openSettings();
                } catch {}
              }}
              style={[styles.permissionButton, { backgroundColor: Colors.light.success }]}
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
            style={[styles.permissionButton, { backgroundColor: Colors.light.success }]}
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
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{
          barcodeTypes: [
            "ean13",
            "ean8",
            "upc_a",
            "upc_e",
            "code128",
            "code39",
            "code93",
            "datamatrix",
            "qr",
          ],
        }}
        onBarcodeScanned={handleBarCodeScanned}
      />

      <View style={[styles.overlay, { paddingTop: insets.top + Spacing.md }]}>
        <View style={styles.topControls}>
          <Pressable
            onPress={() => setTorch(!torch)}
            style={[
              styles.controlButton,
              { backgroundColor: torch ? Colors.light.success : "rgba(0,0,0,0.4)" },
            ]}
          >
            <Feather
              name={torch ? "zap" : "zap-off"}
              size={24}
              color="#FFFFFF"
            />
          </Pressable>
        </View>

        <View style={styles.reticleContainer}>
          <AnimatedView style={[styles.reticle, cornerStyle]}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </AnimatedView>

          <AnimatedView
            style={[
              styles.successPulse,
              successStyle,
              { backgroundColor: Colors.light.success },
            ]}
          />

          <ThemedText type="body" style={styles.reticleText}>
            {isScanning ? "Scanning..." : "Point at barcode or nutrition label"}
          </ThemedText>
        </View>

        <View
          style={[
            styles.bottomControls,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
        >
          <Pressable onPress={handlePickImage} style={styles.galleryButton}>
            <Feather name="image" size={28} color="#FFFFFF" />
          </Pressable>

          <AnimatedView style={pulseStyle}>
            <Pressable
              onPress={handleShutterPress}
              style={[
                styles.shutterButton,
                { backgroundColor: Colors.light.success },
              ]}
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
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing["3xl"],
    borderRadius: BorderRadius.full,
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
    justifyContent: "flex-start",
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
    width: 280,
    height: 180,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: Colors.light.success,
    borderWidth: 4,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderBottomWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: 16,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderTopRightRadius: 16,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: 16,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomRightRadius: 16,
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
