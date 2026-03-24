import React, { useState, useCallback, useEffect } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { VoiceLogButton } from "@/components/VoiceLogButton";
import { ParsedFoodPreview } from "@/components/ParsedFoodPreview";
import { AdaptiveGoalCard } from "@/components/AdaptiveGoalCard";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useParseFoodText, type ParsedFoodItem } from "@/hooks/useFoodParse";
import { usePremiumContext } from "@/context/PremiumContext";
import { useAdaptiveGoals } from "@/hooks/useAdaptiveGoals";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

// ── Tip Card ──────────────────────────────────────────────────────────────────

const QUICK_LOG_TIPS = [
  { text: "Did you have a beverage with your meal?", icon: "coffee" as const },
  { text: "Snap a pic to log it!", icon: "camera" as const },
  {
    text: "Try voice input \u2014 tap the mic and speak",
    icon: "mic" as const,
  },
  { text: "Don\u2019t forget condiments and sauces", icon: "droplet" as const },
  { text: "You can log multiple items at once", icon: "list" as const },
];

function randomTip() {
  return QUICK_LOG_TIPS[Math.floor(Math.random() * QUICK_LOG_TIPS.length)];
}

// ── Examples ──────────────────────────────────────────────────────────────────

const EXAMPLE_ITEMS = [
  "2 eggs and toast with butter",
  "chicken salad with ranch dressing",
  "a bowl of oatmeal with blueberries",
  "grande latte and a banana",
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuickLogScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const { isPremium } = usePremiumContext();
  const { data: adaptiveGoalData } = useAdaptiveGoals(isPremium);

  const [textInput, setTextInput] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedFoodItem[]>([]);
  const [tip] = useState(randomTip);

  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();
  const parseFoodText = useParseFoodText();

  const isParsing = parseFoodText.isPending;

  // Fetch frequent items (inline query — no separate hook)
  const { data: frequentItems } = useQuery({
    queryKey: QUERY_KEYS.frequentItems,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/scanned-items/frequent?limit=5",
      );
      const data = (await res.json()) as {
        items: { productName: string }[];
      };
      return data.items;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Stream transcript into text input while listening
  useEffect(() => {
    if (isListening && transcript) {
      setTextInput(transcript);
    }
  }, [isListening, transcript]);

  // Auto-trigger parse when recognition produces a final result
  useEffect(() => {
    if (isFinal && transcript) {
      setTextInput(transcript);
      parseFoodText.mutate(transcript, {
        onSuccess: (data) => {
          setParsedItems(data.items);
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        },
        onError: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          toast.error("Failed to parse food text. Please try again.");
        },
      });
    }
  }, [isFinal, transcript, parseFoodText, haptics, toast]);

  // Show speech errors
  useEffect(() => {
    if (speechError) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error(speechError);
    }
  }, [speechError, toast, haptics]);

  const handleTextSubmit = useCallback(() => {
    if (!textInput.trim()) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    parseFoodText.mutate(textInput.trim(), {
      onSuccess: (data) => {
        setParsedItems(data.items);
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      },
      onError: () => {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        toast.error("Failed to parse food text. Please try again.");
      },
    });
  }, [textInput, haptics, parseFoodText, toast]);

  const handleVoicePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening, haptics]);

  const handleRemoveItem = useCallback((index: number) => {
    setParsedItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleChipPress = useCallback(
    (text: string) => {
      setTextInput(text);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    },
    [haptics],
  );

  const handleCameraPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
    InteractionManager.runAfterInteractions(() => {
      navigation.navigate("Scan");
    });
  }, [haptics, navigation]);

  const logAllItems = useMutation({
    mutationFn: async (items: ParsedFoodItem[]) => {
      const results = [];
      for (const item of items) {
        // POST /api/scanned-items creates both the scanned item
        // AND a daily log entry in a single transaction
        const res = await apiRequest("POST", "/api/scanned-items", {
          productName: `${item.quantity} ${item.unit} ${item.name}`,
          sourceType: "voice",
          calories: item.calories?.toString(),
          protein: item.protein?.toString(),
          carbs: item.carbs?.toString(),
          fat: item.fat?.toString(),
          servingSize: item.servingSize,
        });
        results.push(await res.json());
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.frequentItems });
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Food items logged");
      toast.success("Food items logged");
      setParsedItems([]);
      setTextInput("");
      navigation.goBack();
    },
    onError: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error("Failed to log some items. Please try again.");
    },
  });

  const handleLogAll = useCallback(() => {
    if (parsedItems.length === 0) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    logAllItems.mutate(parsedItems);
  }, [parsedItems, haptics, logAllItems]);

  const hasPreviousItems =
    frequentItems !== undefined && frequentItems.length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        contentContainerStyle={{
          paddingBottom: insets.bottom + Spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Text Input */}
        <Card elevation={1} style={styles.inputCard}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Quick Log
          </ThemedText>
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
                isListening
                  ? "Listening..."
                  : "e.g., 2 eggs and toast with butter"
              }
              placeholderTextColor={theme.textSecondary}
              value={textInput}
              onChangeText={setTextInput}
              onSubmitEditing={handleTextSubmit}
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
                  backgroundColor: theme.link,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="camera" size={24} color={theme.buttonText} />
            </Pressable>
            <Pressable
              onPress={handleTextSubmit}
              disabled={isParsing || !textInput.trim()}
              accessibilityLabel="Parse food text"
              accessibilityRole="button"
              accessibilityState={{
                disabled: isParsing || !textInput.trim(),
                busy: isParsing,
              }}
              style={({ pressed }) => [
                styles.parseButton,
                {
                  backgroundColor: theme.link,
                  opacity: pressed || isParsing || !textInput.trim() ? 0.6 : 1,
                },
              ]}
            >
              {isParsing ? (
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
                isListening={isListening}
                volume={volume}
                onPress={handleVoicePress}
                disabled={isParsing}
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

        {/* Parsed items preview */}
        <ParsedFoodPreview
          items={parsedItems}
          onRemoveItem={handleRemoveItem}
          onLogAll={handleLogAll}
          isLogging={logAllItems.isPending}
        />

        {/* Tip card + suggestions (when no parsed items) */}
        {parsedItems.length === 0 && !isParsing && (
          <View style={styles.helpSection}>
            {/* Previous Items or Examples */}
            <ThemedText
              type="caption"
              accessibilityRole="header"
              style={[styles.helpText, { color: theme.textSecondary }]}
            >
              {hasPreviousItems ? "Previous Items:" : "Examples:"}
            </ThemedText>
            {(hasPreviousItems
              ? (frequentItems ?? []).map((item) => ({
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
                onPress={() => handleChipPress(label)}
                accessibilityLabel={`${a11yPrefix}: ${label}`}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.exampleChip,
                  {
                    backgroundColor: withOpacity(theme.link, 0.1),
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <ThemedText style={[styles.exampleText, { color: theme.link }]}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}

            {/* Instructional tip */}
            <View
              style={[
                styles.tipCard,
                {
                  backgroundColor: withOpacity(theme.link, 0.15),
                  borderColor: withOpacity(theme.link, 0.25),
                },
              ]}
              accessible={true}
              accessibilityLabel={tip.text}
            >
              <Feather
                name={tip.icon}
                size={20}
                color={theme.link}
                style={styles.tipIcon}
              />
              <ThemedText
                style={[styles.tipText, { color: theme.link }]}
                numberOfLines={2}
              >
                {tip.text}
              </ThemedText>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inputCard: {
    margin: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    marginBottom: Spacing.xs,
  },
  hint: {
    marginBottom: Spacing.md,
  },
  inputRow: {
    marginBottom: Spacing.md,
  },
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
  helpSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.lg,
  },
  tipIcon: {
    marginRight: Spacing.md,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
  helpText: {
    marginBottom: Spacing.sm,
  },
  exampleChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.xs,
  },
  exampleText: {
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
});
