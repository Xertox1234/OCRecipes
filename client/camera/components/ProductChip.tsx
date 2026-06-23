// client/camera/components/ProductChip.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  type ViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  withSpring,
  useAnimatedStyle,
  runOnJS,
} from "react-native-reanimated";
import type { ScanPhase } from "../types/scan-phase";
import {
  getProductChipVariant,
  getSmartConfirmLabel,
} from "./ProductChip-utils";

const CHIP_SPRING = { damping: 18, stiffness: 280 };

function confidenceLabel(score: number): string {
  if (score >= 0.8) return "High confidence";
  if (score >= 0.5) return "Good match";
  return "Possible match";
}

interface Props {
  phase: ScanPhase;
  onConfirm: () => void;
  onAddNutritionPhoto: () => void;
  onAddFrontPhoto: () => void;
  onStepConfirmed: () => void;
  onEditStep2: () => void;
  onEditStep3: () => void;
  onSmartPhotoConfirm: () => void;
  onRetry: () => void;
  /**
   * Forwarded to the chip's root view. ScanScreen sets this to
   * `"no-hide-descendants"` while the confirm overlay is up so the chip leaves
   * the Android TalkBack tree (the chip's own `accessibilityViewIsModal` only
   * traps focus on iOS). No-op on iOS.
   */
  importantForAccessibility?: ViewProps["importantForAccessibility"];
}

export function ProductChip({
  phase,
  onConfirm,
  onAddNutritionPhoto,
  onAddFrontPhoto,
  onStepConfirmed,
  onEditStep2,
  onEditStep3,
  onSmartPhotoConfirm,
  onRetry,
  importantForAccessibility,
}: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(200);
  const variant = getProductChipVariant(phase);
  const [shouldRender, setShouldRender] = useState(variant !== null);
  const prevVariantRef = useRef<typeof variant>(null);

  useEffect(() => {
    if (variant !== null) {
      setShouldRender(true);
      translateY.value = withSpring(0, CHIP_SPRING);
      // Announce only on null→non-null transition (chip sliding in for the first time or after hide).
      // accessibilityLiveRegion on the container handles Android; gate iOS here to avoid double-announce.
      if (prevVariantRef.current === null && Platform.OS === "ios") {
        const announceText: Record<NonNullable<typeof variant>, string> = {
          barcode_lock: "Product found, tap to view details",
          step2_review: "Nutrition label scanned, review values",
          step2_confirmed: "Nutrition values confirmed",
          step3_review: "Front label scanned, review values",
          session_complete: "Scan complete",
          smart_photo: "Photo analyzed, tap to confirm",
          smart_error: "Couldn't identify this food, try again",
        };
        AccessibilityInfo.announceForAccessibility(announceText[variant]);
      }
    } else {
      translateY.value = withSpring(200, CHIP_SPRING, () => {
        runOnJS(setShouldRender)(false);
      });
    }
    prevVariantRef.current = variant;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translateY is a stable useSharedValue ref
  }, [variant]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!shouldRender) return null;

  const product = "product" in phase ? phase.product : undefined;

  return (
    <Animated.View
      style={[styles.chip, { paddingBottom: 20 + insets.bottom }, animStyle]}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
      importantForAccessibility={importantForAccessibility}
    >
      {/* Product info row */}
      <View style={styles.productRow}>
        {product?.imageUri ? (
          <Image source={{ uri: product.imageUri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]} />
        )}
        <View style={styles.productText}>
          {product?.brand ? (
            <Text style={styles.brand}>{product.brand}</Text>
          ) : null}
          <Text style={styles.name} numberOfLines={2}>
            {product?.name ?? "Product"}
          </Text>
        </View>
      </View>

      {/* Actions by variant */}
      {variant === "barcode_lock" && (
        <>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onConfirm}
            accessibilityLabel="Confirm product"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={onAddNutritionPhoto}
            accessibilityLabel="Add nutrition photo"
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryText}>Add nutrition photo</Text>
            <Text style={styles.optionalBadge}>Optional</Text>
          </TouchableOpacity>
        </>
      )}

      {variant === "step2_review" && (
        <>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onStepConfirmed}
            accessibilityLabel="Confirm nutrition values"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={onEditStep2}
            accessibilityLabel="Edit nutrition values"
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryText}>Edit values</Text>
          </TouchableOpacity>
        </>
      )}

      {variant === "step2_confirmed" && (
        <>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onConfirm}
            accessibilityLabel="Finish scan"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={onAddFrontPhoto}
            accessibilityLabel="Add front label photo"
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryText}>Add front label photo</Text>
            <Text style={styles.optionalBadge}>Optional</Text>
          </TouchableOpacity>
        </>
      )}

      {variant === "step3_review" && (
        <>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onConfirm}
            accessibilityLabel="Confirm product complete"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={onEditStep3}
            accessibilityLabel="Edit front label values"
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryText}>Edit values</Text>
          </TouchableOpacity>
        </>
      )}

      {variant === "session_complete" && (
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={onConfirm}
          accessibilityLabel="Complete scan session"
          accessibilityRole="button"
        >
          <Text style={styles.btnPrimaryText}>Done →</Text>
        </TouchableOpacity>
      )}

      {variant === "smart_photo" && phase.type === "SMART_CONFIRMED" && (
        <>
          <View style={styles.classificationRow}>
            <Text style={styles.classificationName}>
              {getSmartConfirmLabel(phase.classification)}
            </Text>
            <Text style={styles.classificationConfidence}>
              {confidenceLabel(phase.classification.overallConfidence)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onSmartPhotoConfirm}
            accessibilityLabel="Confirm smart photo analysis"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </TouchableOpacity>
        </>
      )}

      {variant === "smart_error" && (
        <>
          <Text style={styles.errorText}>
            Couldn&apos;t identify this. Try again?
          </Text>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={onRetry}
            accessibilityLabel="Retry smart photo analysis"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Try again</Text>
          </TouchableOpacity>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(12,12,12,0.94)", // hardcoded — camera overlay
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
    borderRadius: 18,
    padding: 20,
    gap: 10,
  },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
  },
  thumbPlaceholder: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  productText: { flex: 1 },
  brand: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginBottom: 2,
  },
  name: {
    color: "#FFF", // hardcoded — camera overlay
    fontSize: 16,
    fontWeight: "600",
  },
  btnPrimary: {
    backgroundColor: "#FFF", // hardcoded — camera overlay
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnPrimaryText: {
    color: "#000", // hardcoded — camera overlay
    fontWeight: "700",
    fontSize: 15,
  },
  btnSecondary: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  btnSecondaryText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontWeight: "500",
  },
  optionalBadge: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  btnLink: {
    alignItems: "center",
    paddingVertical: 8,
  },
  btnLinkText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
  },
  errorText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 4,
  },
  classificationRow: {
    marginBottom: 4,
  },
  classificationName: {
    color: "#FFF", // hardcoded — camera overlay
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 2,
  },
  classificationConfidence: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
  },
});
