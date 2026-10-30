import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AccessibilityInfo,
} from "react-native";
import { FocusTextInput } from "@/components/FocusTextInput";
import { FocusField } from "@/components/FocusField";
import { useFieldFocus } from "@/components/useFieldFocus";
import { LABELLED_INPUT_TEXT } from "@/components/field-focus-utils";
import {
  resolvePlaceholder,
  shouldFloatLabel,
} from "@/components/text-input-utils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { VoiceLogButton } from "@/components/VoiceLogButton";
import { ParsedFoodPreview } from "@/components/ParsedFoodPreview";
import { AnimatedCheckmark } from "@/components/AnimatedCheckmark";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import {
  useQuickLogSession,
  EMPTY_PARSE_MESSAGE,
} from "@/hooks/useQuickLogSession";
import {
  foundItemsMessage,
  useParsedItemsAnnouncement,
} from "@/hooks/useParsedItemsAnnouncement";
import { usePremiumContext } from "@/context/PremiumContext";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useOfflineGuard } from "@/hooks/useOfflineGuard";
import { FeatureTip } from "@/components/FeatureTip";
import { useFeatureTip } from "@/hooks/useFeatureTip";
import { runAfterTransition } from "@/lib/run-after-transition";
import {
  AbsoluteFill,
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

const INPUT_LABEL = "What did you eat?";

const QUICK_LOG_TIPS = [
  { text: "Did you have a beverage with your meal?", icon: "coffee" as const },
  { text: "Snap a pic to log it!", icon: "camera" as const },
  { text: "Try voice input — tap the mic and speak", icon: "mic" as const },
  { text: "Don't forget condiments and sauces", icon: "droplet" as const },
  { text: "You can log multiple items at once", icon: "list" as const },
];

function randomTip() {
  return QUICK_LOG_TIPS[Math.floor(Math.random() * QUICK_LOG_TIPS.length)];
}

const EXAMPLE_ITEMS = [
  "2 eggs and toast with butter",
  "chicken salad with ranch dressing",
  "a bowl of oatmeal with blueberries",
  "grande latte and a banana",
];

export default function QuickLogScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isPremium, isPremiumResolved } = usePremiumContext();
  // Coach, recent actions and deep links open this screen directly, so the
  // gate lives here, not only on Home's row. It reads the server-resolved,
  // expiry-aware feature, and waits for the subscription to load so a premium
  // user never sees the upgrade flow flash (the server still enforces it).
  const canQuickLog = usePremiumFeature("textFoodParsing");
  const isLocked = isPremiumResolved && !canQuickLog;
  const { isOffline, offlineLabel } = useOfflineGuard();

  // Offline transitions are announced by the always-mounted global OfflineBanner
  // (client/components/OfflineBanner.tsx) — iOS via announceForAccessibility,
  // Android via its assertive live-region alert. A per-screen announce here would
  // double-announce, so none is added.

  const [tip] = useState(randomTip);
  const [showCheckmark, setShowCheckmark] = useState(false);

  const inputFocus = useFieldFocus();
  const session = useQuickLogSession({
    // This full-screen surface is "open" while mounted and unlocked —
    // without this the hook's frequent-items query stays disabled and
    // "Previous Items" never renders here (it defaults isOpen to false for
    // drawer consumers). Suppressed while locked: the `isLocked` early
    // return below never reaches the "Previous Items" UI, so a locked
    // render has no use for the query and must not fire it.
    isOpen: !isLocked,
    onLogSuccess: () => {
      AccessibilityInfo.announceForAccessibility("Food items logged");
      setShowCheckmark(true);
    },
  });
  // Once they start typing a food, point at the camera: "Snap it instead."
  const cameraTip = useFeatureTip("quicklog-camera", {
    feature: "scan",
    eligible: session.inputText.trim().length > 0,
  });

  React.useEffect(() => {
    if (session.speechError) {
      toast.error(session.speechError);
    }
  }, [session.speechError, toast]);

  // useQuickLogSession fires the Error haptic when it sets parseError /
  // submitError (QuickLogDrawer shows them inline and relies on that), so
  // these toasts stay silent.
  React.useEffect(() => {
    if (session.parseError) toast.error(session.parseError, { haptic: false });
  }, [session.parseError, toast]);

  React.useEffect(() => {
    if (session.parseEmpty) toast.info(EMPTY_PARSE_MESSAGE);
  }, [session.parseEmpty, toast]);

  React.useEffect(() => {
    if (session.submitError) {
      toast.error(session.submitError, { haptic: false });
    }
  }, [session.submitError, toast]);

  React.useEffect(() => {
    if (session.capWarning) toast.info(session.capWarning);
  }, [session.capWarning, toast]);

  useParsedItemsAnnouncement(
    session.parseGeneration,
    session.parsedItems.length,
  );

  const handleCameraPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
    runAfterTransition(() => {
      navigation.navigate("Scan");
    });
  }, [haptics, navigation]);

  const handleCheckmarkComplete = useCallback(() => {
    setShowCheckmark(false);
    navigation.goBack();
  }, [navigation]);

  const hasPreviousItems =
    session.frequentItems !== undefined && session.frequentItems.length > 0;

  if (isLocked) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      >
        <UpgradeModal visible={true} onClose={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      accessibilityViewIsModal
    >
      <ScrollView
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Card elevation={1} style={styles.inputCard}>
          <ThemedText
            type="caption"
            style={[styles.hint, { color: theme.textSecondary }]}
          >
            Type or speak what you ate
          </ThemedText>
          <View style={styles.inputRow}>
            <FocusField
              focus={inputFocus}
              label={INPUT_LABEL}
              // The input pads its own text; the label lines up with it.
              labelLeft={Spacing.md}
              // Listening floats the label too, so "Listening..." shows even
              // while the field is unfocused and empty.
              hasValue={session.inputText.length > 0 || session.isListening}
              style={[
                styles.inputBox,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
            >
              <FocusTextInput
                focusRing={false}
                onFocus={inputFocus.onFocus}
                onBlur={inputFocus.onBlur}
                style={[styles.textInput, { color: theme.text }]}
                // The label rests where the placeholder would; it shows once floated.
                placeholder={resolvePlaceholder(
                  INPUT_LABEL,
                  session.isListening
                    ? "Listening..."
                    : "e.g., 2 eggs and toast with butter",
                  shouldFloatLabel(
                    inputFocus.focused || session.isListening,
                    session.inputText,
                  ),
                )}
                placeholderTextColor={theme.textSecondary}
                value={session.inputText}
                onChangeText={session.setInputText}
                onSubmitEditing={session.handleTextSubmit}
                returnKeyType="done"
                // Multiline defaults to "newline" (the key would never submit); blur
                // too, so the keyboard leaves the results visible, as in the drawer.
                submitBehavior="blurAndSubmit"
                multiline
                accessibilityLabel={INPUT_LABEL}
              />
            </FocusField>
          </View>
          <FeatureTip
            text="Snap it instead."
            visible={cameraTip.visible}
            onDismiss={cameraTip.dismiss}
            pointer="down"
            pointerAlign="start"
          />
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleCameraPress}
              accessibilityLabel="Take a photo to log food"
              accessibilityHint="Closes quick log and opens the camera"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cameraButton,
                {
                  backgroundColor: "transparent",
                  borderWidth: 1.5,
                  borderColor: theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="camera" size={22} color={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={session.handleTextSubmit}
              disabled={session.isParsing || !session.inputText.trim()}
              accessibilityLabel="Parse food text"
              accessibilityRole="button"
              accessibilityState={{
                disabled: session.isParsing || !session.inputText.trim(),
                busy: session.isParsing,
              }}
              style={({ pressed }) => [
                styles.parseButton,
                {
                  backgroundColor: theme.accentSolid,
                  opacity:
                    pressed || session.isParsing || !session.inputText.trim()
                      ? 0.6
                      : 1,
                },
              ]}
            >
              {session.isParsing ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <>
                  <Feather name="search" size={18} color={theme.buttonText} />
                  <ThemedText
                    style={[
                      styles.parseButtonText,
                      { color: theme.buttonText },
                    ]}
                  >
                    Parse
                  </ThemedText>
                </>
              )}
            </Pressable>
            {isPremium && (
              <VoiceLogButton
                isListening={session.isListening}
                volume={session.volume}
                onPress={session.handleVoicePress}
                disabled={session.isParsing}
              />
            )}
          </View>
        </Card>

        {session.parsedItems.length > 0 && (
          <ThemedText
            type="small"
            style={{
              color: theme.textSecondary,
              textAlign: "center",
              marginTop: Spacing.xs,
            }}
            accessibilityLiveRegion="polite"
          >
            {foundItemsMessage(session.parsedItems.length)}
          </ThemedText>
        )}
        <ParsedFoodPreview
          items={session.parsedItems}
          onRemoveItem={session.removeItem}
          onLogAll={session.submitLog}
          isLogging={session.isSubmitting}
          logAllLabel={isOffline ? offlineLabel("Log All") : undefined}
        />
        {isOffline && session.parsedItems.length > 0 && (
          <ThemedText
            type="small"
            style={{
              color: theme.textSecondary,
              textAlign: "center",
              marginTop: Spacing.xs,
            }}
          >
            You&apos;re offline. This will sync when you reconnect.
          </ThemedText>
        )}

        {session.parsedItems.length === 0 && !session.isParsing && (
          <View style={styles.helpSection}>
            <ThemedText
              type="caption"
              accessibilityRole="header"
              style={[styles.helpText, { color: theme.textSecondary }]}
            >
              {hasPreviousItems ? "Previous Items:" : "Examples:"}
            </ThemedText>
            {(hasPreviousItems
              ? (session.frequentItems ?? []).map((item) => ({
                  key: item.productName,
                  label: item.productName,
                  a11yPrefix: "Use previous item",
                }))
              : EXAMPLE_ITEMS.map((example) => ({
                  key: example,
                  label: example,
                  a11yPrefix: "Use example",
                }))
            ).map(({ key, label, a11yPrefix }) => (
              <Pressable
                key={key}
                onPress={() => session.handleChipPress(label)}
                accessibilityLabel={`${a11yPrefix}: ${label}`}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.exampleChip,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderLeftWidth: 3,
                    borderLeftColor: withOpacity(theme.link, 0.4),
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <ThemedText style={[styles.exampleText, { color: theme.text }]}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}

            <View
              style={[
                styles.tipCard,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
              accessible={true}
              accessibilityLabel={tip.text}
            >
              <Feather
                name={tip.icon}
                size={20}
                color={theme.textSecondary}
                style={styles.tipIcon}
              />
              <ThemedText
                style={[styles.tipText, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {tip.text}
              </ThemedText>
            </View>
          </View>
        )}
      </ScrollView>
      {showCheckmark && (
        <View style={styles.checkmarkOverlay} pointerEvents="none">
          <AnimatedCheckmark
            visible={showCheckmark}
            size={64}
            onComplete={handleCheckmarkComplete}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inputCard: { margin: Spacing.lg, marginTop: 80, marginBottom: Spacing.sm },
  hint: { marginBottom: Spacing.md },
  inputRow: { marginBottom: Spacing.md },
  inputBox: {
    minHeight: 60,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
  },
  // Labelled field: the value sits under the floated label's row.
  textInput: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
    ...LABELLED_INPUT_TEXT,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    textAlignVertical: "top",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  cameraButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  parseButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    height: 44,
    borderRadius: BorderRadius.xs,
  },
  parseButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  helpSection: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl },
  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.lg,
  },
  tipIcon: { marginRight: Spacing.md },
  tipText: { flex: 1, fontSize: 14, fontFamily: FontFamily.medium },
  helpText: { marginBottom: Spacing.sm },
  exampleChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.sm,
  },
  exampleText: { fontSize: 14, fontFamily: FontFamily.regular },
  checkmarkOverlay: {
    ...AbsoluteFill,
    justifyContent: "center",
    alignItems: "center",
  },
});
