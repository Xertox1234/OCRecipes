import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Pressable,
  Text,
  StyleSheet,
  Alert,
  AccessibilityInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { CameraView, useCameraPermissions, useCamera } from "@/camera";
import { useBatchScan } from "@/context/BatchScanContext";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { usePremiumCamera } from "@/hooks/usePremiumFeatures";
import { isValidBarcode } from "@shared/constants/classification";
import { withOpacity, Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type BatchScanNavProp = NativeStackNavigationProp<
  RootStackParamList,
  "BatchScan"
>;

const MAX_ITEMS = 50;

export default function BatchScanScreen() {
  const navigation = useNavigation<BatchScanNavProp>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { permission, requestPermission } = useCameraPermissions();
  const { availableBarcodeTypes } = usePremiumCamera();

  const {
    itemCount,
    startSession,
    addItemAndLookup,
    incrementQuantity,
    clearSession,
  } = useBatchScan();

  // Announcement cadence tracking
  const announcementCountRef = React.useRef(0);

  // Start session on mount
  useEffect(() => {
    startSession();
    announcementCountRef.current = 0;
  }, [startSession]);

  // Local animated toast
  const toastOpacity = useSharedValue(0);
  const [toastText, setToastText] = useState("");

  const toastAnimatedStyle = useAnimatedStyle(() => ({
    opacity: toastOpacity.value,
  }));

  const showScanToast = useCallback(
    (message: string) => {
      setToastText(message);
      cancelAnimation(toastOpacity);
      toastOpacity.value = 1;
      toastOpacity.value = withTiming(0, { duration: 1500 });
    },
    [toastOpacity],
  );

  // Barcode scanned handler
  const onBarcodeScanned = useCallback(
    (result: { data: string }, isRepeat?: boolean) => {
      if (!isValidBarcode(result.data)) return;
      if (itemCount >= MAX_ITEMS) return;

      haptics.notification(Haptics.NotificationFeedbackType.Success);

      if (isRepeat) {
        incrementQuantity(result.data);
        showScanToast("Quantity increased");

        // Announce duplicate
        AccessibilityInfo.announceForAccessibility(
          "Item already scanned. Quantity increased.",
        );
      } else {
        addItemAndLookup(result.data);
        announcementCountRef.current++;
        const count = announcementCountRef.current;

        if (count >= MAX_ITEMS) {
          showScanToast(`Maximum ${MAX_ITEMS} items reached`);
          AccessibilityInfo.announceForAccessibility(
            `Maximum ${MAX_ITEMS} items reached. Tap Done to review.`,
          );
        } else {
          showScanToast(`Item #${count} scanned`);

          // Announce 1st, then every 5th
          if (count === 1) {
            AccessibilityInfo.announceForAccessibility(
              `First item scanned. ${count} item total.`,
            );
          } else if (count % 5 === 0) {
            AccessibilityInfo.announceForAccessibility(
              `${count} items scanned.`,
            );
          }
        }
      }
    },
    [itemCount, haptics, incrementQuantity, addItemAndLookup, showScanToast],
  );

  const { cameraRef, handleBarcodeScanned } = useCamera({
    onBarcodeScanned,
    batch: true,
    debounceMs: 2000,
  });

  // Back gesture interception
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (itemCount === 0) return;

      e.preventDefault();
      Alert.alert(
        "Discard scanned items?",
        `You have ${itemCount} item${itemCount !== 1 ? "s" : ""}. Discard and leave?`,
        [
          { text: "Keep Scanning", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              clearSession();
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });

    return unsubscribe;
  }, [navigation, itemCount, clearSession]);

  // Handle "Done" press
  const handleDone = useCallback(() => {
    navigation.navigate("BatchSummary");
  }, [navigation]);

  // Handle close
  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Request permission on mount
  useEffect(() => {
    if (permission?.status !== "granted") {
      requestPermission();
    }
  }, [permission, requestPermission]);

  if (permission?.status !== "granted") {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        accessibilityViewIsModal
      >
        <Text style={[styles.permissionText, { color: theme.text }]}>
          Camera permission is required for batch scanning.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={[styles.permissionButton, { backgroundColor: theme.link }]}
          accessibilityRole="button"
          accessibilityLabel="Grant camera permission"
        >
          <Text
            style={[styles.permissionButtonText, { color: theme.buttonText }]}
          >
            Grant Permission
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container} accessibilityViewIsModal>
      {/* Camera — wrapped in View with accessible={false} to keep VoiceOver off the preview */}
      <View accessible={false} style={StyleSheet.absoluteFill}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          barcodeTypes={availableBarcodeTypes}
          isActive={isFocused && itemCount < MAX_ITEMS}
          onBarcodeScanned={handleBarcodeScanned}
        />
      </View>

      {/* Close button (top-left) */}
      <Pressable
        onPress={handleClose}
        style={[
          styles.closeButton,
          {
            top: insets.top + Spacing.sm,
            backgroundColor: withOpacity(theme.backgroundRoot, 0.7),
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Close batch scan"
        hitSlop={12}
      >
        <Feather name="x" size={24} color={theme.text} />
      </Pressable>

      {/* Count badge (top-right) */}
      {itemCount > 0 && (
        <View
          style={[
            styles.countBadge,
            {
              top: insets.top + Spacing.sm,
              backgroundColor: withOpacity(theme.backgroundRoot, 0.85),
            },
          ]}
          accessibilityRole="text"
          accessibilityLabel={`${itemCount} item${itemCount !== 1 ? "s" : ""} scanned`}
          accessibilityLiveRegion="polite"
        >
          <Feather
            name="layers"
            size={16}
            color={theme.link}
            style={styles.countIcon}
          />
          <Text style={[styles.countText, { color: theme.text }]}>
            {itemCount}
          </Text>
        </View>
      )}

      {/* Local toast (bottom center) */}
      <Animated.View
        style={[
          styles.toast,
          toastAnimatedStyle,
          {
            bottom: insets.bottom + 120,
            backgroundColor: withOpacity(theme.backgroundRoot, 0.85),
          },
        ]}
        pointerEvents="none"
      >
        <Text style={[styles.toastText, { color: theme.text }]}>
          {toastText}
        </Text>
      </Animated.View>

      {/* Done button (bottom-right) - shown after first scan */}
      {itemCount > 0 && (
        <Pressable
          onPress={handleDone}
          style={[
            styles.doneButton,
            {
              bottom: insets.bottom + Spacing.xl,
              backgroundColor: theme.link,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Done, review ${itemCount} scanned item${itemCount !== 1 ? "s" : ""}`}
        >
          <Text style={[styles.doneText, { color: theme.buttonText }]}>
            Done ({itemCount})
          </Text>
          <Feather name="arrow-right" size={18} color={theme.buttonText} />
        </Pressable>
      )}

      {/* Max items reached overlay */}
      {itemCount >= MAX_ITEMS && (
        <View
          style={[
            styles.maxOverlay,
            {
              bottom: insets.bottom + 80,
              backgroundColor: withOpacity(theme.backgroundRoot, 0.9),
            },
          ]}
        >
          <Text style={[styles.maxText, { color: theme.text }]}>
            Maximum {MAX_ITEMS} items reached
          </Text>
        </View>
      )}
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
  countBadge: {
    position: "absolute",
    right: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    zIndex: 10,
  },
  countIcon: {
    marginRight: Spacing.xs,
  },
  countText: {
    fontSize: 16,
    fontWeight: "700",
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "500",
  },
  doneButton: {
    position: "absolute",
    right: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    gap: Spacing.xs,
  },
  doneText: {
    fontSize: 16,
    fontWeight: "600",
  },
  maxOverlay: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
  },
  maxText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
