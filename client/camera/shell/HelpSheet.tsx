// The "?" help sheet: the current step's help, a way back to its example card
// and the general tips. Presentational only — the screen decides when it is
// visible and what "Show the example again" does.
import React, { useCallback, useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetSpringConfigs,
} from "@gorhom/bottom-sheet";
import type {
  BottomSheetBackdropProps,
  BottomSheetModal as BottomSheetModalType,
} from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import { PressableScale } from "@/components/PressableScale";
import { useHaptics } from "@/hooks/useHaptics";
import { useSheetBackHandler } from "@/hooks/useSheetBackHandler";
import { helpSheetSpringConfig } from "@/constants/animations";
import {
  CameraColors,
  Colors,
  FontFamily,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";

interface Tip {
  icon: keyof typeof Feather.glyphMap;
  text: string;
}

const GENERAL_TIPS: Tip[] = [
  { icon: "target", text: "Hold still for a moment" },
  { icon: "sun", text: "Use plenty of light, or tap ⚡" },
  { icon: "maximize", text: "Fill the frame, nothing cut off" },
];

const TYPE_NUMBER_TIP: Tip = {
  icon: "hash",
  text: "Barcode won't read? Type the number",
};

// Sheet content and the link both read as accent text on the dark surface.
const ACCENT_TEXT = Colors.dark.link;

interface HelpSheetProps {
  visible: boolean;
  stepTitle: string;
  stepHint: string;
  showTypeNumberTip: boolean;
  onShowExample: () => void;
  onClose: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps) {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="close"
    />
  );
}

export function HelpSheet({
  visible,
  stepTitle,
  stepHint,
  showTypeNumberTip,
  onShowExample,
  onClose,
}: HelpSheetProps) {
  const haptics = useHaptics();
  const sheetRef = useRef<BottomSheetModalType>(null);
  // No-bounce spring for the slide up and the drop away (spec motion plan).
  const animationConfigs = useBottomSheetSpringConfigs(helpSheetSpringConfig);

  // State-driven host: Android back dismisses the sheet, not the screen.
  const { onSheetChange, onSheetAnimate } = useSheetBackHandler(
    sheetRef,
    visible,
  );

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  const handleShowExample = useCallback(() => {
    haptics.selection();
    onShowExample();
  }, [haptics, onShowExample]);

  const tips = showTypeNumberTip
    ? [...GENERAL_TIPS, TYPE_NUMBER_TIP]
    : GENERAL_TIPS;

  return (
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose
      animationConfigs={animationConfigs}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      onChange={onSheetChange}
      onAnimate={onSheetAnimate}
      onDismiss={onClose}
      // gorhom's default accessible=true collapses the sheet into one opaque
      // VoiceOver element; false keeps every row reachable. Must be `false`,
      // not null. See docs/solutions/logic-errors/gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md.
      accessible={false}
    >
      {/* BottomSheetModal does not forward accessibilityViewIsModal, so the
          trap goes on the content: VoiceOver stays off the camera behind. */}
      <BottomSheetView style={styles.content} accessibilityViewIsModal>
        <Text
          style={styles.stepTitle}
          accessibilityRole="header"
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
        >
          {stepTitle}
        </Text>
        <Text
          style={styles.stepHint}
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
        >
          {stepHint}
        </Text>
        <PressableScale
          onPress={handleShowExample}
          accessibilityRole="button"
          accessibilityLabel="Show the example again →"
          style={styles.link}
        >
          <Text
            style={styles.linkText}
            maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
          >
            Show the example again →
          </Text>
        </PressableScale>

        <View style={styles.divider} />

        <Text
          style={styles.tipsTitle}
          accessibilityRole="header"
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
        >
          Tips for every scan
        </Text>
        {tips.map((tip) => (
          <View key={tip.text} style={styles.tipRow}>
            <Feather
              name={tip.icon}
              size={16}
              color={ACCENT_TEXT}
              accessible={false}
            />
            <Text
              style={styles.tipText}
              maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
            >
              {tip.text}
            </Text>
          </View>
        ))}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: CameraColors.helpSheetSurface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  handle: { backgroundColor: CameraColors.helpSheetHandle, width: 36 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 32 },
  stepTitle: {
    color: CameraColors.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 17,
    marginBottom: 4,
  },
  stepHint: {
    color: CameraColors.textMuted,
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  linkText: {
    color: ACCENT_TEXT,
    fontFamily: FontFamily.semiBold,
    fontSize: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: CameraColors.helpSheetDivider,
    marginVertical: 8,
  },
  tipsTitle: {
    color: CameraColors.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
    marginBottom: 6,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 36,
  },
  tipText: {
    color: CameraColors.text,
    fontFamily: FontFamily.regular,
    fontSize: 14,
    flexShrink: 1,
  },
});
