// "Type the number" sheet for a barcode that won't scan. Presentational: the
// screen decides when it is visible and dispatches MANUAL_BARCODE_ENTERED from
// onSubmit. The same bottom-sheet shell as HelpSheet.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { FocusBottomSheetTextInput } from "@/components/FocusBottomSheetTextInput";
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
import { normalizeTypedBarcode } from "./manual-barcode-utils";

interface ManualBarcodeSheetProps {
  visible: boolean;
  onSubmit: (barcode: string) => void;
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

export function ManualBarcodeSheet({
  visible,
  onSubmit,
  onClose,
}: ManualBarcodeSheetProps) {
  const haptics = useHaptics();
  const sheetRef = useRef<BottomSheetModalType>(null);
  const animationConfigs = useBottomSheetSpringConfigs(helpSheetSpringConfig);
  const [text, setText] = useState("");

  const { onSheetChange, onSheetAnimate } = useSheetBackHandler(
    sheetRef,
    visible,
  );

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  const barcode = useMemo(() => normalizeTypedBarcode(text), [text]);
  const canSubmit = barcode !== null;

  const handleSubmit = useCallback(() => {
    if (barcode === null) return;
    haptics.selection();
    onSubmit(barcode);
  }, [barcode, haptics, onSubmit]);

  // A reopened sheet starts empty rather than showing last time's number.
  const handleDismiss = useCallback(() => {
    setText("");
    onClose();
  }, [onClose]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose
      // The library lifts the sheet above the keyboard and puts the focused
      // input in view; BottomSheetTextInput (inside FocusBottomSheetTextInput)
      // reports focus to it.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      animationConfigs={animationConfigs}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      onChange={onSheetChange}
      onAnimate={onSheetAnimate}
      onDismiss={handleDismiss}
      // Must be `false`, not null. See docs/solutions/logic-errors/gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md.
      accessible={false}
    >
      {/* The trap goes on the content, not the modal (docs/solutions/conventions/a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md). */}
      <BottomSheetView style={styles.content} accessibilityViewIsModal>
        <Text
          style={styles.title}
          accessibilityRole="header"
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
        >
          Type the number
        </Text>
        <Text
          style={styles.hint}
          maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
        >
          The digits under the barcode, 8 to 14 of them
        </Text>
        <FocusBottomSheetTextInput
          value={text}
          onChangeText={setText}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
          placeholder="e.g. 0 32601 03105 3"
          placeholderTextColor={CameraColors.textMuted}
          accessibilityLabel="Barcode number"
          autoFocus
          maxLength={20}
          style={styles.input}
        />
        <PressableScale
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Look up barcode"
          accessibilityState={{ disabled: !canSubmit }}
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
        >
          <View>
            <Text
              style={[
                styles.submitText,
                !canSubmit && styles.submitTextDisabled,
              ]}
              maxFontSizeMultiplier={MAX_FONT_SCALE_CONSTRAINED}
            >
              Look up
            </Text>
          </View>
        </PressableScale>
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
  title: {
    color: CameraColors.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 17,
    marginBottom: 4,
  },
  hint: {
    color: CameraColors.textMuted,
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CameraColors.helpSheetHandle,
    backgroundColor: CameraColors.overlayLight,
    paddingHorizontal: 14,
    color: CameraColors.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 20,
    letterSpacing: 1,
  },
  submit: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.dark.accentSolid,
  },
  // Muted fill and text: visibly inert next to the terracotta enabled state.
  submitDisabled: { backgroundColor: CameraColors.helpSheetDivider },
  submitText: {
    color: CameraColors.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 16,
  },
  submitTextDisabled: { color: CameraColors.textMuted },
});
