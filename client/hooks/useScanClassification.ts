import { useState, useRef, useEffect, useCallback } from "react";
import { Platform, AccessibilityInfo } from "react-native";
import { useNavigation } from "@react-navigation/native";

import {
  uploadPhotoForAnalysis,
  type PhotoAnalysisResponse,
} from "@/lib/photo-upload";
import {
  shouldAutoRoute,
  getConfirmationMessage,
  getContentTypeLabel,
  getPremiumGate,
} from "@/screens/scan-screen-utils";
import type { ContentType } from "@shared/constants/classification";
import type { ScanScreenNavigationProp } from "@/types/navigation";

/** Timeout ref type for cleanup */
type TimeoutRef = ReturnType<typeof setTimeout> | null;

export type ClassifyState =
  | "idle"
  | "classifying"
  | "classified"
  | "confirming"
  | "error";

export function useScanClassification({
  isPremium,
  refreshScanCount,
  onUpgradeNeeded,
  isFocused,
}: {
  isPremium: boolean;
  refreshScanCount: () => void;
  onUpgradeNeeded: () => void;
  /**
   * Pass `useIsFocused()` from the consuming screen. When the screen loses
   * focus while a classification is in-flight, `isClassifyingRef` is reset
   * to prevent navigating the user away from an unrelated screen.
   * (L20 — 2026-04-18)
   */
  isFocused?: boolean;
}) {
  const navigation = useNavigation<ScanScreenNavigationProp>();

  const [classifyState, setClassifyState] = useState<ClassifyState>("idle");
  const [classifyResult, setClassifyResult] =
    useState<PhotoAnalysisResponse | null>(null);
  const [classifyImageUri, setClassifyImageUri] = useState<string | null>(null);
  const isClassifyingRef = useRef(false);
  const classifyTimeoutRef = useRef<TimeoutRef>(null);
  const autoRouteTimeoutRef = useRef<TimeoutRef>(null);
  const navigationTimeoutRef = useRef<TimeoutRef>(null);
  const resetTimeoutRef = useRef<TimeoutRef>(null);
  const latestOCRTextRef = useRef<string | undefined>(undefined);

  // Timer refs must be read at cleanup time (not captured at setup) — these are
  // timer IDs, not React DOM refs, so the exhaustive-deps warning is inapplicable.
  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current)
        clearTimeout(navigationTimeoutRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
      if (classifyTimeoutRef.current) clearTimeout(classifyTimeoutRef.current);
      if (autoRouteTimeoutRef.current)
        clearTimeout(autoRouteTimeoutRef.current);
    };
  }, []);

  // L20 (2026-04-18): Reset in-flight classifying state when the screen loses
  // focus. Without this, a pending upload could navigate the user away from
  // a completely different screen after they had already left ScanScreen.
  useEffect(() => {
    if (isFocused === false) {
      isClassifyingRef.current = false;
      if (classifyTimeoutRef.current) {
        clearTimeout(classifyTimeoutRef.current);
        classifyTimeoutRef.current = null;
      }
      if (autoRouteTimeoutRef.current) {
        clearTimeout(autoRouteTimeoutRef.current);
        autoRouteTimeoutRef.current = null;
      }
    }
  }, [isFocused]);

  /** Navigate to the appropriate screen based on classification result */
  const routeFromClassification = useCallback(
    (result: PhotoAnalysisResponse, imageUri: string) => {
      const contentType = result.contentType as ContentType | undefined;
      if (!contentType) {
        navigation.navigate("PhotoAnalysis", {
          imageUri,
          intent: result.resolvedIntent ?? "log",
        });
        return;
      }

      const gate = getPremiumGate(contentType);
      if (gate && !isPremium) {
        setClassifyState("idle");
        onUpgradeNeeded();
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
          navigation.navigate("MenuScanResult", {
            imageUri,
            localOCRText: latestOCRTextRef.current,
          });
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
    },
    [isPremium, navigation, onUpgradeNeeded],
  );

  /** Run smart scan classification on a photo */
  const handleSmartScan = useCallback(
    async (imageUri: string, localOCRText?: string) => {
      if (isClassifyingRef.current) return;
      isClassifyingRef.current = true;
      latestOCRTextRef.current = localOCRText;
      setClassifyState("classifying");
      setClassifyImageUri(imageUri);

      classifyTimeoutRef.current = setTimeout(() => {
        if (isClassifyingRef.current) {
          isClassifyingRef.current = false;
          setClassifyState("idle");
          navigation.navigate("PhotoIntent", { imageUri });
        }
      }, 10000);

      try {
        const result = await uploadPhotoForAnalysis(imageUri, "auto");
        if (classifyTimeoutRef.current) {
          clearTimeout(classifyTimeoutRef.current);
          classifyTimeoutRef.current = null;
        }

        if (!isClassifyingRef.current) return;

        setClassifyResult(result);
        refreshScanCount();

        if (result.contentType && shouldAutoRoute(result.confidence ?? 0)) {
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
          setClassifyState("confirming");
          if (Platform.OS === "ios") {
            AccessibilityInfo.announceForAccessibility(
              getConfirmationMessage(result.contentType as ContentType),
            );
          }
        } else {
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
        navigation.navigate("PhotoIntent", { imageUri });
      }
    },
    [navigation, refreshScanCount, routeFromClassification],
  );

  const handleConfirm = useCallback(() => {
    isClassifyingRef.current = false;
    setClassifyState("idle");
    if (classifyResult && classifyImageUri) {
      routeFromClassification(classifyResult, classifyImageUri);
    }
  }, [classifyResult, classifyImageUri, routeFromClassification]);

  const handleDismiss = useCallback(() => {
    isClassifyingRef.current = false;
    setClassifyState("idle");
    if (classifyImageUri) {
      navigation.navigate("PhotoIntent", {
        imageUri: classifyImageUri,
      });
    }
  }, [classifyImageUri, navigation]);

  const handleRetake = useCallback(() => {
    isClassifyingRef.current = false;
    setClassifyState("idle");
  }, []);

  return {
    classifyState,
    classifyResult,
    classifyImageUri,
    navigationTimeoutRef,
    resetTimeoutRef,
    handleSmartScan,
    handleConfirm,
    handleDismiss,
    handleRetake,
  };
}
