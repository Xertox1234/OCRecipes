// client/camera/components/ProductChip.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
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
  getChipAnnounceText,
  getProductChipVariant,
  getSmartConfirmLabel,
} from "./ProductChip-utils";

const CHIP_SPRING = { damping: 18, stiffness: 280 };
const SPINNER_COLOR = "#000"; // hardcoded — black spinner on the white camera-overlay primary button (styles.btnPrimary)

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
   * True while the smart-photo confirm handler is awaiting on-device OCR (menu
   * path). Drives a visible pending state on the smart-photo confirm button —
   * the parent's `isConfirmingRef` is a ref and can't trigger this re-render.
   */
  isSmartConfirming?: boolean;
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
  isSmartConfirming = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(200);
  const variant = getProductChipVariant(phase);
  // The product name can arrive AFTER the chip is shown: BARCODE_LOCKED renders
  // with no product (a "Product" placeholder), then an async PRODUCT_LOADED adds
  // it while keeping the same phase type (so `variant` is unchanged). Track it so
  // the loaded name can be announced — the variant-keyed effect below won't.
  const productName = "product" in phase ? phase.product?.name : undefined;
  const [shouldRender, setShouldRender] = useState(variant !== null);
  const prevSmartConfirmingRef = useRef(false);
  const prevProductNameRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (variant !== null) {
      setShouldRender(true);
      translateY.value = withSpring(0, CHIP_SPRING);
      // Announce every transition INTO a non-null variant on BOTH platforms.
      // The chip no longer carries a container `accessibilityLiveRegion` (it
      // re-read the whole subtree on any descendant change, including the
      // smart-confirm busy swap — see the busy effect below and
      // docs/rules/accessibility.md), so this imperative announce is now the
      // sole announcer on Android too. The effect is keyed on `variant`, so it
      // fires once per variant change: appear (null→non-null) AND non-null→
      // non-null transitions (e.g. step2_review→step2_confirmed), which the old
      // live-region model announced only on Android and iOS heard not at all.
      AccessibilityInfo.announceForAccessibility(
        getChipAnnounceText(variant, phase),
      );
    } else {
      translateY.value = withSpring(200, CHIP_SPRING, () => {
        runOnJS(setShouldRender)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translateY is a stable useSharedValue ref; `phase` is read only to build the announce string for the current variant and must NOT re-trigger the effect (variant is derived from phase, so a variant transition already covers a meaningful change).
  }, [variant]);

  // Announce the smart-confirm pending state on BOTH platforms on the idle→busy
  // edge. With the container live region removed, this imperative announce is
  // the only "OCR started" signal: on Android it replaces the old live-region
  // re-read of the whole chip (the over-announcement this rework fixes); on iOS
  // accessibilityState.busy posts no VoiceOver announcement on its own. Fire
  // only on the false→true edge (guarded by the prev ref so it doesn't fire on
  // mount or on clear). The busy→idle clear is left silent because every confirm
  // outcome now self-announces: `navigate` (the new screen announces itself),
  // `blocked` (UpgradeModal announces itself), `unrecognized` (the SMART_ERROR
  // chip variant announces), and `abort` (the user already left).
  useEffect(() => {
    if (isSmartConfirming && !prevSmartConfirmingRef.current) {
      AccessibilityInfo.announceForAccessibility("Analyzing photo…");
    }
    prevSmartConfirmingRef.current = isSmartConfirming;
  }, [isSmartConfirming]);

  // Announce a product name that loads AFTER the chip is already shown. The
  // BARCODE_LOCKED → PRODUCT_LOADED update keeps the same phase type, so the
  // variant-keyed effect above does NOT re-fire — yet the visible product row
  // changes from a "Product" placeholder to the real name. The old container
  // live region re-read the subtree on this change (so Android spoke the loaded
  // name); with it removed, announce the name explicitly on BOTH platforms.
  // Edge-guarded on undefined→name so it fires once on load, not on the initial
  // appear (where the name is absent and the variant announce already spoke) nor
  // on later variant transitions that merely carry the name forward.
  useEffect(() => {
    if (productName && !prevProductNameRef.current) {
      AccessibilityInfo.announceForAccessibility(productName);
    }
    prevProductNameRef.current = productName;
  }, [productName]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!shouldRender) return null;

  const product = "product" in phase ? phase.product : undefined;

  return (
    <Animated.View
      style={[styles.chip, { paddingBottom: 20 + insets.bottom }, animStyle]}
      accessibilityViewIsModal
      // No `accessibilityLiveRegion` here: a polite region on this shared
      // container re-read the ENTIRE chip subtree on any descendant change —
      // including the smart-confirm Text↔ActivityIndicator busy swap and the
      // button's busy/disabled accessibilityState change — instead of just
      // signalling "busy". Announcements are now driven imperatively per
      // transition (see the two effects above) on both platforms.
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
            style={[styles.btnPrimary, isSmartConfirming && styles.btnPending]}
            onPress={onSmartPhotoConfirm}
            disabled={isSmartConfirming}
            accessibilityLabel="Confirm smart photo analysis"
            accessibilityRole="button"
            // TouchableOpacity does not auto-propagate `disabled` to
            // accessibilityState (unlike Pressable) — set it explicitly.
            accessibilityState={{
              busy: isSmartConfirming,
              disabled: isSmartConfirming,
            }}
          >
            {isSmartConfirming ? (
              <ActivityIndicator size="small" color={SPINNER_COLOR} />
            ) : (
              <Text style={styles.btnPrimaryText}>Looks right →</Text>
            )}
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
  btnPending: {
    opacity: 0.6,
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
