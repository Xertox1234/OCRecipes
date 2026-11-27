// client/camera/components/ProductChip.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  Text,
  type ViewProps,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  useAnimatedStyle,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { PressableScale } from "@/components/PressableScale";
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
import { announceTogether } from "@/lib/announce-together";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  bannerEntrySpring,
  contentRevealTimingConfig,
} from "@/constants/animations";
import { CameraColors, Colors } from "@/constants/theme";
import type { ScanPhase } from "../types/scan-phase";
import {
  getBarcodeLockActions,
  getChipAnnounceText,
  getProductChipVariant,
  getShutterClearanceStyle,
  getFoundCardActionBeats,
  getSmartResultCopy,
} from "./ProductChip-utils";

// The card rises with the banner spring, clamped: it settles without the ~4%
// overshoot (spec motion plan, "Found card"). Reduced motion fades it instead.
const CHIP_SPRING = { ...bannerEntrySpring, overshootClamping: true };
// Off-screen distance for the enter/exit spring. Must clear the chip's own
// rendered height PLUS the shutter-clearance raise (insets.bottom + 96, see
// getShutterClearanceStyle below) on every device — every variant is raised
// now, so 200 (correct when the chip rested flush at bottom: 0) no longer
// leaves enough margin; 400 comfortably covers the tallest variant (~210px)
// plus the largest realistic raised offset (~136px) with headroom.
const OFF_SCREEN_Y = 400;

export type LookupErrorKind = "offline" | "failed";

export const LOOKUP_ERROR_TEXT: Record<LookupErrorKind, string> = {
  offline: "Couldn't look this up. Check your connection.",
  failed: "Something went wrong looking this up.",
};

interface Props {
  phase: ScanPhase;
  onConfirm: () => void;
  /** "Not this" on the found card: drop the lock and resume scanning. */
  onRescan: () => void;
  /**
   * The barcode lookup came back with no product. The found card then says
   * so instead of showing the name skeleton, and drops the "use database
   * data" link (there is none). Leaving it unset keeps the skeleton.
   */
  productNotFound?: boolean;
  /**
   * Hide the step-3 prompt card (`step2_confirmed`). The camera shell's Front
   * step offers the shutter and Skip itself, so the card would only repeat
   * Skip and cover the step tabs.
   */
  hideFrontPrompt?: boolean;
  /**
   * QuickLogDrawer's flow: the found card's primary logs straight away
   * ("Log it →", via onConfirm) and there is no photo-step action.
   */
  returnAfterLog?: boolean;
  /**
   * The product lookup for this barcode failed (not a 404): "offline" for a
   * network failure, "failed" for a server error. The card says so in one
   * line and offers Try again / Type it in instead of a skeleton forever.
   */
  lookupError?: LookupErrorKind | null;
  /** Try again: re-run the lookup for the locked barcode. */
  onRetryLookup?: () => void;
  /** Type it in: open the type-the-number sheet. */
  onTypeBarcode?: () => void;
  onProceedToLabel: () => void;
  onStepConfirmed: () => void;
  onRetakeStep2: () => void;
  onRetakeStep3: () => void;
  onSmartPhotoConfirm: () => void;
  onRetry: () => void;
  /** "Pick it myself" on the unclear card: choose what to scan by hand. */
  onPickItMyself?: () => void;
  /**
   * True while the smart-photo confirm handler is awaiting on-device OCR (menu
   * path). Drives a visible pending state on the smart-photo confirm button —
   * the parent's `isConfirmingRef` is a ref and can't trigger this re-render.
   */
  isSmartConfirming?: boolean;
  /**
   * True while VoiceOver/TalkBack is active. The auto-advancing review card
   * (step2_review/step3_review) falls back to explicit Confirm/Retake buttons
   * in this mode — the ~1.5 s auto-advance timer in ScanScreen is suppressed for
   * screen-reader users (see docs/rules/accessibility.md and the design spec),
   * so this state needs its own explicit continue affordance instead.
   */
  screenReaderEnabled?: boolean;
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
  onRescan,
  onProceedToLabel,
  onStepConfirmed,
  onRetakeStep2,
  onRetakeStep3,
  onSmartPhotoConfirm,
  onRetry,
  onPickItMyself,
  importantForAccessibility,
  isSmartConfirming = false,
  screenReaderEnabled = false,
  productNotFound = false,
  hideFrontPrompt = false,
  returnAfterLog = false,
  lookupError = null,
  onRetryLookup,
  onTypeBarcode,
}: Props) {
  const insets = useSafeAreaInsets();
  const { reducedMotion } = useAccessibility();
  const translateY = useSharedValue(reducedMotion ? 0 : OFF_SCREEN_Y);
  const opacity = useSharedValue(0);
  // The found card's buttons: 0 → 1 a beat after the card body (row, then link).
  const actionRowIn = useSharedValue(0);
  const actionLinkIn = useSharedValue(0);
  const beats = getFoundCardActionBeats(reducedMotion);
  const phaseVariant = getProductChipVariant(phase);
  const variant =
    hideFrontPrompt && phaseVariant === "step2_confirmed" ? null : phaseVariant;
  // The product name can arrive AFTER the chip is shown: BARCODE_LOCKED renders
  // with no product (a skeleton line on the found card), then an async PRODUCT_LOADED adds
  // it while keeping the same phase type (so `variant` is unchanged). Track it so
  // the loaded name can be announced — the variant-keyed effect below won't.
  const productName = "product" in phase ? phase.product?.name : undefined;
  // Same async-load timing as productName above (both arrive together in the
  // PRODUCT_LOADED dispatch) — tracked separately so its announce is
  // content-keyed on the flag itself, not the product name.
  //
  // Reads `topFlag` (Task 14: highest-severity flag across ALL kinds —
  // allergen OR universal/nutrition, ties broken toward allergen), not the
  // narrower Phase-1 `safetyFlag` (tier==="safety" only) — that field still
  // exists on ProductSummary for its safety-tier-only semantics but has no
  // reader today; ScanScreen's fail-dangerous haptic uses its own local
  // `pickTopSafetyFlag` result, not the field on the dispatched product.
  const topFlagTitle =
    "product" in phase ? phase.product?.topFlag?.title : undefined;
  const topFlagDetail =
    "product" in phase ? phase.product?.topFlag?.detail : undefined;
  const [shouldRender, setShouldRender] = useState(variant !== null);
  const prevSmartConfirmingRef = useRef(false);
  const prevProductNameRef = useRef<string | undefined>(undefined);
  const prevTopFlagTitleRef = useRef<string | undefined>(undefined);

  // Mount the chip on each change into a non-null variant — set during render
  // (React's "adjust state when a prop changes" pattern), so the chip is in
  // the same commit as the variant. Unmounting waits for the exit spring below.
  const [prevVariant, setPrevVariant] = useState(variant);
  if (variant !== prevVariant) {
    setPrevVariant(variant);
    if (variant !== null) setShouldRender(true);
  }

  useEffect(() => {
    if (variant !== null) {
      opacity.value = withTiming(1, contentRevealTimingConfig);
      // Reduced motion drops the travel and keeps the fade.
      translateY.value = reducedMotion ? 0 : withSpring(0, CHIP_SPRING);
      if (
        variant === "barcode_lock" ||
        variant === "smart_photo" ||
        variant === "smart_error"
      ) {
        // Card body first, then the buttons. Under reduced motion both delays
        // are 0 and the buttons simply fade in with the card.
        actionRowIn.value = 0;
        actionLinkIn.value = 0;
        actionRowIn.value = withDelay(
          beats.rowDelay,
          withTiming(1, contentRevealTimingConfig),
        );
        actionLinkIn.value = withDelay(
          beats.linkDelay,
          withTiming(1, contentRevealTimingConfig),
        );
      }
      // Announce every transition INTO a non-null variant on BOTH platforms.
      // The chip no longer carries a container `accessibilityLiveRegion` (it
      // re-read the whole subtree on any descendant change, including the
      // smart-confirm busy swap — see the busy effect below and
      // docs/rules/accessibility.md), so this imperative announce is now the
      // sole announcer on Android too. The effect is keyed on `variant`, so it
      // fires once per variant change: appear (null→non-null) AND non-null→
      // non-null transitions (e.g. step2_review→step2_confirmed), which the old
      // live-region model announced only on Android and iOS heard not at all.
      // Batched with the step tabs / hint changing in the same commit
      // (VoiceOver cuts off a second announcement made in the same tick);
      // the card's content leads.
      announceTogether(getChipAnnounceText(variant, phase), { first: true });
    } else {
      // Unmount only when the exit spring settles. A variant that returns
      // mid-exit starts the enter spring above, which cancels this one and
      // fires the callback with finished=false; hiding then would hide a
      // chip that is showing a variant.
      const hide = (finished?: boolean) => {
        "worklet";
        if (finished) scheduleOnRN(setShouldRender, false);
      };
      if (reducedMotion) {
        opacity.value = withTiming(0, contentRevealTimingConfig, hide);
      } else {
        translateY.value = withSpring(OFF_SCREEN_Y, CHIP_SPRING, hide);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translateY/opacity/actionRowIn/actionLinkIn are stable useSharedValue refs; reducedMotion (and `beats`, derived from it) is read at the transition only (a live change applies on the next one); `phase` is read only to build the announce string for the current variant and must NOT re-trigger the effect (variant is derived from phase, so a variant transition already covers a meaningful change).
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

  // Announce a product name and/or safety flag that load AFTER the chip is
  // already shown. The BARCODE_LOCKED → PRODUCT_LOADED update keeps the same
  // phase type, so the variant-keyed effect above does NOT re-fire — yet the
  // visible product row changes from a skeleton line to the real name,
  // and a safety flag badge may appear alongside it. The old container live
  // region re-read the subtree on this change (so Android spoke both); with it
  // removed, this single effect drives the announcement explicitly.
  //
  // Platform split (do NOT unconditionally fire both announces — see below):
  // - Android: only the name is announced imperatively here. The safety flag
  //   badge below carries its own `accessibilityLiveRegion="assertive"`, which
  //   TalkBack reads on its own — announcing the flag here too would double it.
  // - iOS: `accessibilityLiveRegion` posts NO announcement at all, so this
  //   effect is iOS's ONLY signal for both the name and the flag. Name and
  //   flag arrive together in the same PRODUCT_LOADED commit, so firing two
  //   separate `announceForAccessibility` calls in the same JS tick makes
  //   VoiceOver drop one of them (confirmed pattern — see the confirm-card
  //   announce effect in ScanScreen.tsx, which folds the same two pieces of
  //   state into one utterance for the same reason). Fold them into ONE
  //   combined utterance when they arrive together; fall back to a flag-only
  //   announce only if the flag lands on a LATER commit than the name
  //   (currently theoretical — both fields come from the same dispatch today).
  //
  // Edge-guarded via the prev refs so each piece announces once, on its own
  // undefined→defined transition, not on every render.
  useEffect(() => {
    const nameJustArrived = !!productName && !prevProductNameRef.current;
    const flagJustArrived = !!topFlagTitle && !prevTopFlagTitleRef.current;

    if (Platform.OS === "ios") {
      if (nameJustArrived && flagJustArrived) {
        const flagText = topFlagDetail
          ? `${topFlagTitle}. ${topFlagDetail}`
          : topFlagTitle;
        AccessibilityInfo.announceForAccessibility(
          `${productName}. ${flagText}`,
        );
      } else {
        if (nameJustArrived) {
          AccessibilityInfo.announceForAccessibility(productName!);
        }
        if (flagJustArrived) {
          AccessibilityInfo.announceForAccessibility(
            topFlagDetail ? `${topFlagTitle}. ${topFlagDetail}` : topFlagTitle!,
          );
        }
      }
    } else if (nameJustArrived) {
      AccessibilityInfo.announceForAccessibility(productName!);
    }

    prevProductNameRef.current = productName;
    prevTopFlagTitleRef.current = topFlagTitle;
  }, [productName, topFlagTitle, topFlagDetail]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
  // The buttons stay pressable while they arrive: the beat is short and a
  // press mid-fade must still land.
  const travel = beats.travel;
  const actionRowStyle = useAnimatedStyle(() => ({
    opacity: actionRowIn.value,
    transform: [{ translateY: (1 - actionRowIn.value) * travel }],
  }));
  const actionLinkStyle = useAnimatedStyle(() => ({
    opacity: actionLinkIn.value,
    transform: [{ translateY: (1 - actionLinkIn.value) * travel }],
  }));

  const barcodeLockActions = getBarcodeLockActions(
    phase.type === "BARCODE_LOCKED"
      ? phase.product?.verificationLevel
      : undefined,
    { returnAfterLog },
  );
  const runLockAction = (intent: "proceedToLabel" | "confirmProduct") =>
    intent === "proceedToLabel" ? onProceedToLabel : onConfirm;

  if (!shouldRender) return null;

  const product = "product" in phase ? phase.product : undefined;

  // Clear the shutter row: every variant raises the chip above ScanScreen's
  // bottom controls (shutter) instead of sitting flush behind it. See
  // getShutterClearanceStyle for the derivation.
  const { bottom: chipBottom } = getShutterClearanceStyle(insets.bottom);

  return (
    <Animated.View
      style={[styles.chip, { bottom: chipBottom }, animStyle]}
      accessibilityViewIsModal
      // No `accessibilityLiveRegion` here: a polite region on this shared
      // container re-read the ENTIRE chip subtree on any descendant change —
      // including the smart-confirm Text↔ActivityIndicator busy swap and the
      // button's busy/disabled accessibilityState change — instead of just
      // signalling "busy". Announcements are now driven imperatively per
      // transition (see the two effects above) on both platforms.
      importantForAccessibility={importantForAccessibility}
    >
      {variant === "barcode_lock" ? (
        <>
          {/* Found card: names what it caught (spec concept, "show me, then
              tell me what you saw"). */}
          <View style={styles.foundRow}>
            {product?.imageUri ? (
              <Image
                source={{ uri: product.imageUri }}
                style={styles.thumb}
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
            <View style={styles.productText}>
              {/* The visible "✓" stays out of the spoken label. */}
              <Text style={styles.cardTitle} accessibilityLabel="Barcode found">
                Barcode found ✓
              </Text>
              {lookupError ? (
                <Text style={styles.cardSub}>
                  {LOOKUP_ERROR_TEXT[lookupError]}
                </Text>
              ) : productNotFound ? (
                <Text style={styles.cardSub}>
                  We don&apos;t know this one yet. The label and front photos
                  will fill it in
                </Text>
              ) : product ? (
                <Text style={styles.cardSub} numberOfLines={2}>
                  {product.brand
                    ? `${product.name} · ${product.brand}`
                    : product.name}
                </Text>
              ) : (
                // Name still loading: a skeleton line, never "Loading…".
                <View
                  testID="found-card-name-skeleton"
                  style={styles.skeleton}
                  accessible={false}
                  importantForAccessibility="no"
                />
              )}
            </View>
          </View>

          {/* Top flag (badges only — never blocks the flow): the
              highest-severity flag across ALL kinds (Task 14). It sits below
              the name row, never inside it. The wrapper keeps the assertive
              live region the old inline row had: it is Android's only cue for
              a flag that loads after the card shows (iOS: the effect above). */}
          {product?.topFlag ? (
            <View accessibilityLiveRegion="assertive">
              <ScanFlagBadge flag={product.topFlag} scheme="dark" />
            </View>
          ) : null}

          {lookupError ? (
            <>
              {/* The lookup failed: retry it or type the number, never a
                  silent return to the camera. The flow's own next step
                  stays reachable below. */}
              <Animated.View style={[styles.actionRow, actionRowStyle]}>
                <ChipButton
                  tone="ghost"
                  style={styles.actionFlex}
                  onPress={() => onRetryLookup?.()}
                  accessibilityLabel="Try again"
                >
                  Try again
                </ChipButton>
                <ChipButton
                  tone="accent"
                  style={styles.actionFlex}
                  onPress={() => onTypeBarcode?.()}
                  accessibilityLabel="Type it in"
                >
                  Type it in
                </ChipButton>
              </Animated.View>
              <Animated.View style={actionLinkStyle}>
                <ChipButton
                  tone="link"
                  onPress={runLockAction(barcodeLockActions.primary.intent)}
                  accessibilityLabel={barcodeLockActions.primary.label}
                >
                  {barcodeLockActions.primary.label}
                </ChipButton>
              </Animated.View>
            </>
          ) : (
            <>
              <Animated.View style={[styles.actionRow, actionRowStyle]}>
                <ChipButton
                  tone="ghost"
                  style={styles.actionFlex}
                  onPress={onRescan}
                  accessibilityLabel="Not this"
                >
                  Not this
                </ChipButton>
                <ChipButton
                  tone="accent"
                  style={styles.actionFlex}
                  onPress={runLockAction(barcodeLockActions.primary.intent)}
                  accessibilityLabel={barcodeLockActions.primary.label}
                >
                  {barcodeLockActions.primary.label}
                </ChipButton>
              </Animated.View>
              {/* Not in database: there is no database data to use. */}
              {productNotFound || !barcodeLockActions.secondary ? null : (
                <Animated.View style={actionLinkStyle}>
                  <ChipButton
                    tone="link"
                    onPress={runLockAction(barcodeLockActions.secondary.intent)}
                    accessibilityLabel={barcodeLockActions.secondary.label}
                  >
                    {barcodeLockActions.secondary.label}
                  </ChipButton>
                </Animated.View>
              )}
            </>
          )}
        </>
      ) : variant === "step2_review" || variant === "step3_review" ? (
        <>
          {/* The top flag rides on the captured cards too (badges only),
            with the same assertive live region as on the found card. */}
          {product?.topFlag ? (
            <View accessibilityLiveRegion="assertive">
              <ScanFlagBadge flag={product.topFlag} scheme="dark" />
            </View>
          ) : null}
          <CapturedCard
            title={
              variant === "step2_review" ? "Label captured" : "Front captured"
            }
            retakeLabel={
              variant === "step2_review"
                ? "Retake nutrition label photo"
                : "Retake front label photo"
            }
            onRetake={
              variant === "step2_review" ? onRetakeStep2 : onRetakeStep3
            }
            // Explicit Confirm only with a screen reader on: the ~1.5 s
            // auto-advance is suppressed for screen-reader users, so they need
            // their own continue affordance.
            confirm={
              screenReaderEnabled
                ? variant === "step2_review"
                  ? {
                      label: "Confirm nutrition values",
                      onPress: onStepConfirmed,
                    }
                  : { label: "Confirm product complete", onPress: onConfirm }
                : null
            }
          />
        </>
      ) : (
        <>
          {/* Top flag row (badges only — never blocks the flow). Surfaces the
              highest-severity flag across ALL kinds (allergen OR
              universal/nutrition) — Task 14. */}
          {product?.topFlag ? (
            <View
              style={[
                styles.topFlag,
                {
                  backgroundColor:
                    product.topFlag.severity === "danger"
                      ? "rgba(229,72,77,0.22)"
                      : product.topFlag.severity === "warn"
                        ? "rgba(240,171,58,0.20)"
                        : "rgba(100,181,246,0.20)",
                },
              ]}
              accessible={true}
              accessibilityLiveRegion="assertive"
              accessibilityRole="text"
              accessibilityLabel={
                product.topFlag.detail
                  ? `${product.topFlag.title}. ${product.topFlag.detail}`
                  : product.topFlag.title
              }
            >
              <Text style={styles.topFlagText}>⚠ {product.topFlag.title}</Text>
            </View>
          ) : null}

          {/* Product info row */}
          <View style={styles.productRow}>
            {product?.imageUri ? (
              <Image
                source={{ uri: product.imageUri }}
                style={styles.thumb}
                cachePolicy="memory-disk"
              />
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
        </>
      )}

      {variant === "step2_confirmed" && (
        <>
          <PressableScale
            style={styles.btnPrimary}
            onPress={onConfirm}
            accessibilityLabel="Finish scan"
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryText}>Looks right →</Text>
          </PressableScale>
          <Text style={styles.caption}>
            Optional: point at the front of the package to continue.
          </Text>
        </>
      )}

      {variant === "session_complete" && (
        <PressableScale
          style={styles.btnPrimary}
          onPress={onConfirm}
          accessibilityLabel="Complete scan session"
          accessibilityRole="button"
        >
          <Text style={styles.btnPrimaryText}>Done →</Text>
        </PressableScale>
      )}

      {variant === "classifying" && (
        <View style={styles.foundRow}>
          <ActivityIndicator size="small" color={CameraColors.text} />
          <Text style={styles.cardTitle}>Working out what this is…</Text>
        </View>
      )}

      {(variant === "smart_photo" || variant === "smart_error") &&
        (() => {
          const copy =
            phase.type === "SMART_CONFIRMED"
              ? getSmartResultCopy(phase.classification)
              : {
                  kind: "unclear" as const,
                  title: "Couldn't tell what this is",
                  sub: "Try again, or pick what you're scanning",
                };
          const imageUri =
            phase.type === "SMART_CONFIRMED" || phase.type === "SMART_ERROR"
              ? phase.imageUri
              : undefined;
          return (
            <>
              <View style={styles.foundRow}>
                {imageUri ? (
                  <Image
                    source={{ uri: imageUri }}
                    style={styles.thumb}
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]} />
                )}
                <View style={styles.productText}>
                  {/* The visible "✓" stays out of the spoken label. */}
                  <Text
                    style={styles.cardTitle}
                    accessibilityLabel={copy.title.replace(/\s*✓$/, "")}
                  >
                    {copy.title}
                  </Text>
                  <Text style={styles.cardSub} numberOfLines={2}>
                    {copy.sub}
                  </Text>
                </View>
              </View>
              {copy.kind === "found" ? (
                <Animated.View style={[styles.actionRow, actionRowStyle]}>
                  <ChipButton
                    tone="ghost"
                    style={styles.actionFlex}
                    onPress={onRetry}
                    accessibilityLabel="Not this"
                  >
                    Not this
                  </ChipButton>
                  <ChipButton
                    tone="accent"
                    style={styles.actionFlex}
                    onPress={onSmartPhotoConfirm}
                    accessibilityLabel="Continue"
                    busy={isSmartConfirming}
                  >
                    Continue →
                  </ChipButton>
                </Animated.View>
              ) : (
                <>
                  <Animated.View style={[styles.actionRow, actionRowStyle]}>
                    <ChipButton
                      tone="accent"
                      style={styles.actionFlex}
                      onPress={onRetry}
                      accessibilityLabel="Retake"
                    >
                      Retake
                    </ChipButton>
                  </Animated.View>
                  <Animated.View style={actionLinkStyle}>
                    <ChipButton
                      tone="link"
                      onPress={() => onPickItMyself?.()}
                      accessibilityLabel="Pick it myself"
                    >
                      Pick it myself
                    </ChipButton>
                  </Animated.View>
                </>
              )}
            </>
          );
        })()}
    </Animated.View>
  );
}

type ChipButtonTone = "accent" | "ghost" | "link";

/**
 * A found/captured-card button. Press scales (0.96, PressableScale) and also
 * dims, so reduced motion — where usePressScale drops the scale — still
 * answers the tap.
 */
function ChipButton({
  tone,
  onPress,
  accessibilityLabel,
  style,
  busy = false,
  children,
}: {
  tone: ChipButtonTone;
  onPress: () => void;
  accessibilityLabel: string;
  style?: ViewProps["style"];
  /** Swaps the label for a spinner and disables the button. */
  busy?: boolean;
  children: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <PressableScale
      scaleTo={tone === "link" ? 1 : 0.96}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={busy}
      // TouchableOpacity does not auto-propagate `disabled` to
      // accessibilityState (unlike Pressable) — set it explicitly.
      accessibilityState={{ busy, disabled: busy }}
      style={[
        tone === "accent"
          ? styles.btnAccent
          : tone === "ghost"
            ? styles.btnGhost
            : styles.btnTextLink,
        style,
        pressed && styles.btnPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={CameraColors.text} />
      ) : (
        <Text
          style={tone === "link" ? styles.btnTextLinkText : styles.btnCardText}
          // Two lines, not one: half-width buttons at large Dynamic Type
          // would otherwise truncate "Next: nutrition →" mid-word.
          numberOfLines={2}
        >
          {children}
        </Text>
      )}
    </PressableScale>
  );
}

/**
 * "Label captured ✓" / "Front captured ✓" with Retake. Without a screen
 * reader it moves on by itself (ScanScreen's auto-advance timer); with one on
 * it also shows an explicit Confirm.
 */
function CapturedCard({
  title,
  retakeLabel,
  onRetake,
  confirm,
}: {
  title: string;
  retakeLabel: string;
  onRetake: () => void;
  confirm: { label: string; onPress: () => void } | null;
}) {
  return (
    <>
      <View style={styles.capturedRow}>
        {/* The visible "✓" stays out of the spoken label. */}
        <Text
          style={[styles.cardTitle, styles.capturedTitle]}
          accessibilityLabel={title}
        >
          {`${title} ✓`}
        </Text>
        <ChipButton
          tone="ghost"
          style={styles.retake}
          onPress={onRetake}
          accessibilityLabel={retakeLabel}
        >
          Retake
        </ChipButton>
      </View>
      {confirm ? (
        <ChipButton
          tone="accent"
          onPress={confirm.onPress}
          accessibilityLabel={confirm.label}
        >
          Looks right →
        </ChipButton>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    bottom: 0,
    left: 16,
    right: 16,
    // The warm dark card surface (spec: #2C2420, not neutral grey).
    backgroundColor: Colors.dark.surface,
    borderRadius: 20,
    padding: 14,
    gap: 10,
  },
  productRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  topFlag: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  topFlagText: {
    color: "#FFF", // hardcoded — camera overlay
    fontSize: 13,
    fontWeight: "700",
  },
  thumb: {
    width: 44,
    height: 44,
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
    fontSize: 14,
    fontWeight: "600",
  },
  btnPrimary: {
    backgroundColor: "#FFF", // hardcoded — camera overlay
    borderRadius: 999,
    minHeight: 44,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: {
    color: "#1C1410", // hardcoded — warm ink on the white camera-overlay button
    fontWeight: "600",
    fontSize: 15,
  },
  btnPending: {
    opacity: 0.6,
  },
  btnSecondary: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    minHeight: 44,
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
  caption: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
  },
  foundRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardTitle: {
    color: CameraColors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  cardSub: {
    color: CameraColors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  skeleton: {
    height: 12,
    width: "70%",
    borderRadius: 6,
    marginTop: 6,
    backgroundColor: Colors.dark.backgroundTertiary,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  actionFlex: { flex: 1 },
  btnAccent: {
    // accentSolid, not link: the AA-safe fill under white text in dark mode.
    backgroundColor: Colors.dark.accentSolid,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: Colors.dark.backgroundTertiary,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnCardText: {
    color: CameraColors.text,
    fontSize: 15,
    fontWeight: "600",
    // A label that wraps to a second line stays centred in its button.
    textAlign: "center",
  },
  btnTextLink: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  btnTextLinkText: {
    color: CameraColors.textMuted,
    fontSize: 13,
    textDecorationLine: "underline",
  },
  btnPressed: { opacity: 0.7 },
  capturedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  capturedTitle: { flex: 1 },
  retake: { paddingHorizontal: 22 },
});
