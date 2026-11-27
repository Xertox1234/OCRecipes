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
  /** Hide the tabs and the controls row (a found / captured card is up). */
  chromeHidden?: boolean;
  /** Dim the controls and ignore taps (an example card is up). */
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
  staticUIImportance,
  children,
}: CameraShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root} accessibilityViewIsModal>
      {camera}
      {frame}
      {overlay}

      <View
        testID="scan-top-overlay"
        style={[styles.top, { paddingTop: insets.top + 8 }]}
        importantForAccessibility={staticUIImportance}
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
          style={styles.hint}
          importantForAccessibility={staticUIImportance}
        >
          {hint}
        </View>
        {chromeHidden ? null : (
          <View
            style={controlsMuted && styles.muted}
            pointerEvents={controlsMuted ? "none" : "auto"}
            importantForAccessibility={staticUIImportance}
          >
            {tabs ? <View style={styles.tabs}>{tabs}</View> : null}
            <View style={styles.controls}>
              <View style={styles.side}>{left}</View>
              {shutter ?? <View style={styles.shutterSlot} />}
              <View style={styles.side}>{right}</View>
            </View>
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
});
