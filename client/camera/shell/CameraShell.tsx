// The shared scan-camera layout, top to bottom: the camera feed, the frame,
// an optional teaching overlay (example card), the top bar (✕ · title pill or
// nothing · ?), the hint line, the step tabs and the controls row
// (left · shutter or spacer · right). Layout only: the screen supplies every
// control and decides what each one does. `children` render last, above it
// all (found / captured cards, sheets, modals).
import React, { type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ViewProps } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CameraColors,
  FontFamily,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";

// Matches the shutter's 72pt circle so the row stays centred without one.
const SHUTTER_SLOT = 72;

interface CameraShellProps {
  camera: ReactNode;
  frame: ReactNode;
  /** Above the frame, below the chrome (the example card's scrim). */
  overlay?: ReactNode;
  onClose: () => void;
  /** Title pill text; null shows no pill (the barcode flow). */
  title: string | null;
  /** "?" — null hides the button. */
  onHelp: (() => void) | null;
  /** Under the top bar (the daily scan-limit pill). */
  topAccessory?: ReactNode;
  hint: ReactNode;
  tabs?: ReactNode;
  left?: ReactNode;
  /** The shutter; null keeps an empty slot so left/right stay put. */
  shutter: ReactNode | null;
  right?: ReactNode;
  /**
   * A found / captured card is up: the controls row unmounts and the tabs
   * hide (they stay mounted for their done moment).
   */
  chromeHidden?: boolean;
  /**
   * A teaching surface (example card / carousel) is up. The overlay renders
   * BEFORE the chrome, and iOS accessibilityViewIsModal hides only earlier
   * siblings, so the shell hides its own top bar, hint, tabs and controls
   * from both screen readers; the card's own button is the way out.
   */
  obscured?: boolean;
  /** Dim the controls row and ignore its taps (an example card is up). */
  controlsMuted?: boolean;
  /** Android TalkBack trap for the static camera UI (getScanOverlayA11y). */
  staticUIImportance?: ViewProps["importantForAccessibility"];
  children?: ReactNode;
}

export function CameraShell({
  camera,
  frame,
  overlay,
  onClose,
  title,
  onHelp,
  topAccessory,
  hint,
  tabs,
  left,
  shutter,
  right,
  chromeHidden = false,
  controlsMuted = false,
  obscured = false,
  staticUIImportance,
  children,
}: CameraShellProps) {
  const insets = useSafeAreaInsets();
  const chromeImportance = obscured
    ? "no-hide-descendants"
    : staticUIImportance;
  const tabsHidden = chromeHidden || obscured;

  return (
    <View style={styles.root} accessibilityViewIsModal>
      {camera}
      {frame}
      {overlay}

      <View
        testID="scan-top-overlay"
        style={[styles.top, { paddingTop: insets.top + 8 }]}
        accessibilityElementsHidden={obscured}
        importantForAccessibility={chromeImportance}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.roundBtn}
            hitSlop={4}
            onPress={onClose}
            accessibilityLabel="Close camera"
            accessibilityRole="button"
          >
            <Text style={styles.roundBtnText} accessible={false}>
              ✕
            </Text>
          </TouchableOpacity>
          {title ? (
            <View style={styles.titlePill}>
              <Text
                style={styles.titleText}
                accessibilityRole="header"
                maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
              >
                {title}
              </Text>
            </View>
          ) : null}
          {onHelp ? (
            <TouchableOpacity
              style={styles.roundBtn}
              hitSlop={4}
              onPress={onHelp}
              accessibilityLabel="Scan help"
              accessibilityRole="button"
            >
              <Feather
                name="help-circle"
                size={18}
                color={CameraColors.icon}
                accessible={false}
              />
            </TouchableOpacity>
          ) : (
            <View style={styles.roundSpacer} />
          )}
        </View>
        {topAccessory}
      </View>

      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
      >
        <View
          testID="scan-hint"
          style={styles.hint}
          accessibilityElementsHidden={obscured}
          importantForAccessibility={chromeImportance}
        >
          {hint}
        </View>
        {/* The tabs stay mounted while a card is up — hidden from sight,
            touch and both screen readers — so a tab that turns done under
            the card still pops its ✓ and announces it. */}
        {tabs ? (
          <View
            testID="scan-tabs"
            style={[styles.tabs, chromeHidden && styles.hidden]}
            pointerEvents={chromeHidden ? "none" : "auto"}
            accessibilityElementsHidden={tabsHidden}
            importantForAccessibility={
              tabsHidden ? "no-hide-descendants" : staticUIImportance
            }
          >
            {tabs}
          </View>
        ) : null}
        {chromeHidden ? null : (
          <View
            testID="scan-controls"
            style={[styles.controls, controlsMuted && styles.muted]}
            pointerEvents={controlsMuted ? "none" : "auto"}
            accessibilityElementsHidden={obscured}
            importantForAccessibility={chromeImportance}
          >
            <View style={styles.side}>{left}</View>
            {shutter ?? <View style={styles.shutterSlot} />}
            <View style={styles.side}>{right}</View>
          </View>
        )}
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CameraColors.background },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
    gap: 10,
  },
  topBar: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CameraColors.overlayMedium,
    alignItems: "center",
    justifyContent: "center",
  },
  roundSpacer: { width: 44, height: 44 },
  roundBtnText: {
    color: CameraColors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  titlePill: {
    backgroundColor: CameraColors.overlayMedium,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  titleText: {
    color: CameraColors.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
  },
  bottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    gap: 14,
  },
  hint: { alignItems: "center", paddingHorizontal: 24, minHeight: 20 },
  tabs: { marginBottom: 14 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  side: {
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterSlot: { width: SHUTTER_SLOT, height: SHUTTER_SLOT },
  muted: { opacity: 0.4 },
  hidden: { opacity: 0 },
});
