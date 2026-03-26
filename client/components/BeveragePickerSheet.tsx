import React, { useCallback, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  AccessibilityInfo,
  ActivityIndicator,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ImpactFeedbackStyle, NotificationFeedbackType } from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  BEVERAGE_TYPES,
  BEVERAGE_SIZES,
  BEVERAGE_MODIFIERS,
  BEVERAGE_DISPLAY,
  type BeverageType,
  type BeverageSize,
  type BeverageModifier,
} from "@shared/constants/beverages";
import {
  hasModifiers,
  isNumericCalorieInput,
  capitalize,
} from "./beverage-picker-utils";
import type { BeverageSheetOptions } from "@/hooks/useBeverageSheet";

type Step = "beverage" | "modifier" | "size" | "custom";

const SELECTABLE_BEVERAGES = BEVERAGE_TYPES.filter((t) => t !== "custom");
const SIZE_KEYS: BeverageSize[] = ["small", "medium", "large"];
const MAX_DYNAMIC_HEIGHT = 480;
const MAX_CUSTOM_NAME_LENGTH = 100;
const MAX_CUSTOM_CALORIES = 5000;

export interface BeveragePickerSheetProps {
  sheetRef: React.RefObject<BottomSheetModal | null>;
  optionsRef: React.RefObject<BeverageSheetOptions | null>;
}

export function BeveragePickerSheet({
  sheetRef,
  optionsRef,
}: BeveragePickerSheetProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("beverage");
  const [selectedBeverage, setSelectedBeverage] = useState<BeverageType | null>(
    null,
  );
  const [modifiers, setModifiers] = useState<BeverageModifier[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [isLogging, setIsLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActioning = useRef(false);

  const resetState = useCallback(() => {
    setStep("beverage");
    setSelectedBeverage(null);
    setModifiers([]);
    setCustomInput("");
    setIsLogging(false);
    setError(null);
    isActioning.current = false;
  }, []);

  const handleDismiss = useCallback(() => {
    resetState();
  }, [resetState]);

  // --- Step 1: Beverage selection ---

  const handleBeverageSelect = useCallback(
    (type: BeverageType) => {
      haptics.impact(ImpactFeedbackStyle.Light);
      setSelectedBeverage(type);
      setError(null);

      if (type === "custom") {
        setStep("custom");
        AccessibilityInfo.announceForAccessibility("Enter custom beverage");
      } else if (hasModifiers(type)) {
        setStep("modifier");
        const display = BEVERAGE_DISPLAY[type];
        AccessibilityInfo.announceForAccessibility(
          `Add to your ${display.label}?`,
        );
      } else {
        setStep("size");
        AccessibilityInfo.announceForAccessibility("Select size");
      }
    },
    [haptics],
  );

  // --- Step 1.5: Modifier toggles ---

  const toggleModifier = useCallback(
    (mod: BeverageModifier) => {
      haptics.impact(ImpactFeedbackStyle.Light);
      setModifiers((prev) =>
        prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod],
      );
    },
    [haptics],
  );

  const handleModifierDone = useCallback(() => {
    haptics.impact(ImpactFeedbackStyle.Light);
    setStep("size");
    AccessibilityInfo.announceForAccessibility("Select size");
  }, [haptics]);

  // --- Step 2: Size selection → log ---

  const logBeverage = useCallback(
    async (size: BeverageSize) => {
      if (isActioning.current) return;
      isActioning.current = true;
      setIsLogging(true);
      setError(null);

      haptics.impact(ImpactFeedbackStyle.Light);

      const options = optionsRef.current;
      const isCustom = selectedBeverage === "custom";
      const isCalories = isCustom && isNumericCalorieInput(customInput.trim());

      const body: Record<string, unknown> = {
        beverageType: selectedBeverage,
        size,
        modifiers,
        mealType: options?.mealType ?? null,
      };

      if (isCustom) {
        if (isCalories) {
          const parsed = parseFloat(customInput.trim());
          if (isNaN(parsed) || parsed < 0 || parsed > MAX_CUSTOM_CALORIES) {
            setError(`Calories must be between 0 and ${MAX_CUSTOM_CALORIES}`);
            setIsLogging(false);
            isActioning.current = false;
            return;
          }
          body.customCalories = parsed;
        } else {
          const trimmed = customInput.trim();
          if (trimmed.length > MAX_CUSTOM_NAME_LENGTH) {
            setError(
              `Name must be ${MAX_CUSTOM_NAME_LENGTH} characters or less`,
            );
            setIsLogging(false);
            isActioning.current = false;
            return;
          }
          body.customName = trimmed;
        }
      }

      try {
        const res = await apiRequest("POST", "/api/beverages/log", body);

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Failed to log beverage");
          setIsLogging(false);
          isActioning.current = false;
          haptics.notification(NotificationFeedbackType.Error);
          return;
        }

        // Success
        haptics.notification(NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });

        // Build confirmation text and call onLogged callback
        const displayName = isCustom
          ? customInput.trim()
          : (BEVERAGE_DISPLAY[
              selectedBeverage as Exclude<BeverageType, "custom">
            ]?.label ?? selectedBeverage);

        options?.onLogged?.(displayName ?? "", size);
        sheetRef.current?.dismiss();
      } catch {
        setError("Network error. Please try again.");
        setIsLogging(false);
        isActioning.current = false;
        haptics.notification(NotificationFeedbackType.Error);
      }
    },
    [
      selectedBeverage,
      modifiers,
      customInput,
      optionsRef,
      sheetRef,
      haptics,
      queryClient,
    ],
  );

  const handleSizeSelect = useCallback(
    (size: BeverageSize) => {
      logBeverage(size);
    },
    [logBeverage],
  );

  // --- Step 3: Custom input ---

  const handleCustomSubmit = useCallback(() => {
    if (!customInput.trim()) return;
    haptics.impact(ImpactFeedbackStyle.Light);
    setStep("size");
    AccessibilityInfo.announceForAccessibility("Select size");
  }, [customInput, haptics]);

  // --- Back navigation ---

  const handleBack = useCallback(() => {
    haptics.impact(ImpactFeedbackStyle.Light);
    setError(null);
    if (step === "modifier" || step === "custom") {
      setStep("beverage");
      setSelectedBeverage(null);
      setModifiers([]);
      setCustomInput("");
      AccessibilityInfo.announceForAccessibility("Select a beverage");
    } else if (step === "size") {
      if (selectedBeverage === "custom") {
        setStep("custom");
      } else if (hasModifiers(selectedBeverage!)) {
        setStep("modifier");
      } else {
        setStep("beverage");
        setSelectedBeverage(null);
      }
    }
  }, [step, selectedBeverage, haptics]);

  // --- Render ---

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.35}
        pressBehavior="close"
      />
    ),
    [],
  );

  const animationConfigs = reducedMotion ? { duration: 0 } : undefined;
  const showBack = step !== "beverage";

  const beverageLabel =
    selectedBeverage && selectedBeverage !== "custom"
      ? BEVERAGE_DISPLAY[selectedBeverage]?.label
      : null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      maxDynamicContentSize={MAX_DYNAMIC_HEIGHT}
      backdropComponent={renderBackdrop}
      onDismiss={handleDismiss}
      accessibilityViewIsModal
      handleIndicatorStyle={{ display: "none" }}
      backgroundStyle={{ backgroundColor: theme.backgroundDefault }}
      animationConfigs={animationConfigs}
    >
      <BottomSheetView>
        <View
          style={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {/* Drag indicator */}
          <View
            style={[
              styles.dragIndicator,
              { backgroundColor: withOpacity(theme.text, 0.2) },
            ]}
          />

          {/* Header with optional back button */}
          <View style={styles.header}>
            {showBack ? (
              <Pressable
                onPress={handleBack}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={8}
                style={styles.backButton}
              >
                <Feather name="arrow-left" size={20} color={theme.text} />
              </Pressable>
            ) : (
              <View style={styles.backPlaceholder} />
            )}
            <ThemedText
              type="h4"
              style={styles.title}
              accessibilityRole="header"
            >
              {step === "beverage" && "Add a Beverage"}
              {step === "modifier" && `Add to your ${beverageLabel}?`}
              {step === "size" && "Select Size"}
              {step === "custom" && "Custom Beverage"}
            </ThemedText>
            <View style={styles.backPlaceholder} />
          </View>

          {/* Error */}
          {error && (
            <View
              style={[
                styles.errorContainer,
                { backgroundColor: withOpacity(theme.error, 0.1) },
              ]}
            >
              <ThemedText type="caption" style={{ color: theme.error }}>
                {error}
              </ThemedText>
            </View>
          )}

          {/* Step: Beverage selection */}
          {step === "beverage" && (
            <View style={styles.grid} accessibilityLabel="Beverage options">
              {SELECTABLE_BEVERAGES.map((type) => {
                const display = BEVERAGE_DISPLAY[type];
                return (
                  <Pressable
                    key={type}
                    onPress={() => handleBeverageSelect(type)}
                    accessibilityRole="button"
                    accessibilityLabel={display.label}
                    style={[
                      styles.gridItem,
                      {
                        backgroundColor: withOpacity(theme.text, 0.04),
                        borderColor: withOpacity(theme.text, 0.08),
                      },
                    ]}
                  >
                    <Feather
                      name={display.icon as keyof typeof Feather.glyphMap}
                      size={24}
                      color={theme.link}
                    />
                    <ThemedText type="caption" style={styles.gridLabel}>
                      {display.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
              {/* Custom option */}
              <Pressable
                onPress={() => handleBeverageSelect("custom")}
                accessibilityRole="button"
                accessibilityLabel="Custom beverage"
                style={[
                  styles.gridItem,
                  {
                    backgroundColor: withOpacity(theme.text, 0.04),
                    borderColor: withOpacity(theme.text, 0.08),
                  },
                ]}
              >
                <Feather name="edit-3" size={24} color={theme.link} />
                <ThemedText type="caption" style={styles.gridLabel}>
                  Custom
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* Step: Modifier toggles (Coffee/Tea) */}
          {step === "modifier" && (
            <View style={styles.modifierContainer}>
              <View style={styles.modifierRow}>
                {BEVERAGE_MODIFIERS.map((mod) => {
                  const isSelected = modifiers.includes(mod);
                  return (
                    <Pressable
                      key={mod}
                      onPress={() => toggleModifier(mod)}
                      accessibilityRole="switch"
                      accessibilityLabel={capitalize(mod)}
                      accessibilityState={{ checked: isSelected }}
                      style={[
                        styles.modifierChip,
                        {
                          backgroundColor: isSelected
                            ? withOpacity(theme.link, 0.15)
                            : withOpacity(theme.text, 0.04),
                          borderColor: isSelected
                            ? theme.link
                            : withOpacity(theme.text, 0.08),
                        },
                      ]}
                    >
                      {isSelected && (
                        <Feather name="check" size={14} color={theme.link} />
                      )}
                      <ThemedText
                        type="body"
                        style={[
                          styles.modifierText,
                          { color: isSelected ? theme.link : theme.text },
                        ]}
                      >
                        {capitalize(mod)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={handleModifierDone}
                accessibilityRole="button"
                accessibilityLabel={
                  modifiers.length > 0
                    ? "Continue with selected additions"
                    : "Skip additions"
                }
                style={[styles.skipButton, { backgroundColor: theme.link }]}
              >
                <ThemedText
                  type="body"
                  style={[styles.skipButtonText, { color: theme.buttonText }]}
                >
                  {modifiers.length > 0 ? "Continue" : "Skip"}
                </ThemedText>
              </Pressable>
            </View>
          )}

          {/* Step: Size picker */}
          {step === "size" && (
            <View>
              {isLogging ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color={theme.link} />
                  <ThemedText
                    type="caption"
                    style={[styles.loadingText, { color: theme.textSecondary }]}
                  >
                    Logging beverage...
                  </ThemedText>
                </View>
              ) : (
                <View
                  style={styles.sizeRow}
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Size options"
                >
                  {SIZE_KEYS.map((size) => {
                    const sizeData = BEVERAGE_SIZES[size];
                    return (
                      <Pressable
                        key={size}
                        onPress={() => handleSizeSelect(size)}
                        accessibilityRole="radio"
                        accessibilityLabel={`${sizeData.label}, ${sizeData.oz} ounces`}
                        style={[
                          styles.sizeCard,
                          {
                            backgroundColor: withOpacity(theme.text, 0.04),
                            borderColor: withOpacity(theme.text, 0.08),
                          },
                        ]}
                      >
                        <ThemedText
                          type="body"
                          style={[
                            styles.sizeLabel,
                            { fontFamily: FontFamily.semiBold },
                          ]}
                        >
                          {sizeData.label}
                        </ThemedText>
                        <ThemedText
                          type="caption"
                          style={{ color: theme.textSecondary }}
                        >
                          {sizeData.oz}oz / {sizeData.ml}ml
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* Step: Custom input */}
          {step === "custom" && (
            <View style={styles.customContainer}>
              <ThemedText
                type="caption"
                style={[styles.customHint, { color: theme.textSecondary }]}
              >
                Enter a beverage name or calorie amount
              </ThemedText>
              <BottomSheetTextInput
                value={customInput}
                onChangeText={setCustomInput}
                placeholder="e.g. Matcha Latte or 150"
                placeholderTextColor={withOpacity(theme.text, 0.3)}
                returnKeyType="next"
                onSubmitEditing={handleCustomSubmit}
                autoFocus
                maxLength={MAX_CUSTOM_NAME_LENGTH}
                accessibilityLabel="Beverage name or calories"
                style={[
                  styles.customInput,
                  {
                    color: theme.text,
                    backgroundColor: withOpacity(theme.text, 0.04),
                    borderColor: withOpacity(theme.text, 0.1),
                  },
                ]}
              />
              <Pressable
                onPress={handleCustomSubmit}
                disabled={!customInput.trim()}
                accessibilityRole="button"
                accessibilityLabel="Continue to size selection"
                style={[
                  styles.customSubmit,
                  {
                    backgroundColor: customInput.trim()
                      ? theme.link
                      : withOpacity(theme.text, 0.1),
                  },
                ]}
              >
                <ThemedText
                  type="body"
                  style={[
                    styles.skipButtonText,
                    {
                      color: customInput.trim()
                        ? theme.buttonText
                        : theme.textSecondary,
                    },
                  ]}
                >
                  Next
                </ThemedText>
              </Pressable>
            </View>
          )}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  dragIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  backPlaceholder: {
    width: 32,
  },
  title: {
    flex: 1,
    fontFamily: FontFamily.semiBold,
    fontSize: 18,
    textAlign: "center",
  },
  errorContainer: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  // Beverage grid
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  gridItem: {
    width: "30%",
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  gridLabel: {
    fontSize: 13,
  },
  // Modifier toggles
  modifierContainer: {
    gap: Spacing.lg,
  },
  modifierRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  modifierChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.button,
    borderWidth: 1.5,
  },
  modifierText: {
    fontSize: 15,
  },
  skipButton: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.button,
    alignItems: "center",
    justifyContent: "center",
  },
  skipButtonText: {
    fontFamily: FontFamily.semiBold,
    fontWeight: "600",
  },
  // Size picker
  sizeRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  sizeCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  sizeLabel: {
    fontSize: 16,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  loadingText: {
    fontSize: 13,
  },
  // Custom input
  customContainer: {
    gap: Spacing.md,
  },
  customHint: {
    fontSize: 13,
    textAlign: "center",
  },
  customInput: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  customSubmit: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.button,
    alignItems: "center",
    justifyContent: "center",
  },
});
