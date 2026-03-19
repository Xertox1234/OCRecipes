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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

export default function QuickLogScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { isPremium } = usePremiumContext();
  const { data: adaptiveGoalData } = useAdaptiveGoals(isPremium);

  const [textInput, setTextInput] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedFoodItem[]>([]);

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
          toast.error("Failed to parse food text. Please try again.");
        },
      });
    }
  }, [isFinal, transcript, parseFoodText, haptics, toast]);

  // Show speech errors
  useEffect(() => {
    if (speechError) {
      toast.error(speechError);
    }
  }, [speechError, toast]);

  const handleTextSubmit = useCallback(() => {
    if (!textInput.trim()) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    parseFoodText.mutate(textInput.trim(), {
      onSuccess: (data) => {
        setParsedItems(data.items);
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      },
      onError: () => {
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

  const logAllItems = useMutation({
    mutationFn: async (items: ParsedFoodItem[]) => {
      const results = [];
      for (const item of items) {
        const res = await apiRequest("POST", "/api/scanned-items", {
          productName: `${item.quantity} ${item.unit} ${item.name}`,
          sourceType: "voice",
          calories: item.calories?.toString(),
          protein: item.protein?.toString(),
          carbs: item.carbs?.toString(),
          fat: item.fat?.toString(),
          servingSize: item.servingSize,
        });
        const scannedItem = await res.json();
        // Create daily log
        await apiRequest("POST", "/api/daily-summary", {
          scannedItemId: scannedItem.id,
          source: "voice",
        });
        results.push(scannedItem);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scanned-items"] });
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility("Food items logged");
      toast.success("Food items logged");
      setParsedItems([]);
      setTextInput("");
      navigation.goBack();
    },
    onError: () => {
      toast.error("Failed to log some items. Please try again.");
    },
  });

  const handleLogAll = useCallback(() => {
    if (parsedItems.length === 0) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    logAllItems.mutate(parsedItems);
  }, [parsedItems, haptics, logAllItems]);

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
        {adaptiveGoalData?.hasRecommendation &&
          adaptiveGoalData.recommendation && (
            <View
              style={{
                marginHorizontal: Spacing.lg,
                marginTop: Spacing.lg,
                marginBottom: Spacing.sm,
              }}
            >
              <AdaptiveGoalCard
                recommendation={adaptiveGoalData.recommendation}
              />
            </View>
          )}

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

        {/* Parsed items preview */}
        <ParsedFoodPreview
          items={parsedItems}
          onRemoveItem={handleRemoveItem}
          onLogAll={handleLogAll}
          isLogging={logAllItems.isPending}
        />

        {/* Help text */}
        {parsedItems.length === 0 && !isParsing && (
          <View style={styles.helpSection}>
            <ThemedText
              type="caption"
              style={[styles.helpText, { color: theme.textSecondary }]}
            >
              Examples:
            </ThemedText>
            {[
              "2 eggs and toast with butter",
              "chicken salad with ranch dressing",
              "a bowl of oatmeal with blueberries",
              "grande latte and a banana",
            ].map((example) => (
              <Pressable
                key={example}
                onPress={() => {
                  setTextInput(example);
                  haptics.impact(Haptics.ImpactFeedbackStyle.Light);
                }}
                accessibilityLabel={`Use example: ${example}`}
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
                  {example}
                </ThemedText>
              </Pressable>
            ))}
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
