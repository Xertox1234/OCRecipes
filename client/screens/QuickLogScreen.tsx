import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AccessibilityInfo,
  InteractionManager,
} from "react-native";
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
import { AdaptiveGoalCard } from "@/components/AdaptiveGoalCard";
import { AnimatedCheckmark } from "@/components/AnimatedCheckmark";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { useQuickLogSession } from "@/hooks/useQuickLogSession";
import { usePremiumContext } from "@/context/PremiumContext";
import { useAdaptiveGoals } from "@/hooks/useAdaptiveGoals";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

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
  const { isPremium } = usePremiumContext();
  const { data: adaptiveGoalData } = useAdaptiveGoals(isPremium);
  const [tip] = useState(randomTip);
  const [showCheckmark, setShowCheckmark] = useState(false);

  const session = useQuickLogSession({
    onLogSuccess: () => {
      AccessibilityInfo.announceForAccessibility("Food items logged");
      setShowCheckmark(true);
    },
  });

  React.useEffect(() => {
    if (session.speechError) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error(session.speechError);
    }
  }, [session.speechError, toast, haptics]);

  React.useEffect(() => {
    if (session.parseError) toast.error(session.parseError);
  }, [session.parseError, toast]);

  React.useEffect(() => {
    if (session.submitError) toast.error(session.submitError);
  }, [session.submitError, toast]);

  React.useEffect(() => {
    if (session.capWarning) toast.info(session.capWarning);
  }, [session.capWarning, toast]);

  const handleCameraPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
    InteractionManager.runAfterInteractions(() => {
      navigation.navigate("Scan");
    });
  }, [haptics, navigation]);

  const handleCheckmarkComplete = useCallback(() => {
    setShowCheckmark(false);
    navigation.goBack();
  }, [navigation]);

  const hasPreviousItems =
    session.frequentItems !== undefined && session.frequentItems.length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
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
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              placeholder={
                session.isListening
                  ? "Listening..."
                  : "e.g., 2 eggs and toast with butter"
              }
              placeholderTextColor={theme.textSecondary}
              value={session.inputText}
              onChangeText={session.setInputText}
              onSubmitEditing={session.handleTextSubmit}
              returnKeyType="search"
              multiline
              accessibilityLabel="Food description"
            />
          </View>
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
                  backgroundColor: theme.link,
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

        {adaptiveGoalData?.hasRecommendation &&
          adaptiveGoalData.recommendation && (
            <AdaptiveGoalCard
              recommendation={adaptiveGoalData.recommendation}
            />
          )}

        <ParsedFoodPreview
          items={session.parsedItems}
          onRemoveItem={session.removeItem}
          onLogAll={session.submitLog}
          isLogging={session.isSubmitting}
        />

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
  textInput: {
    minHeight: 60,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    borderWidth: 1,
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
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
});
