import React, { useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { TimeServingsData } from "@/hooks/useRecipeForm";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  MIN_SERVINGS,
  MAX_SERVINGS,
  clampServings,
  computeTotalMinutes,
  isServingsAtMax,
  isServingsAtMin,
  sanitizeMinutesInput,
} from "./time-servings-step-utils";

interface TimeServingsStepProps {
  timeServings: TimeServingsData;
  setTimeServings: (data: TimeServingsData) => void;
}

export default function TimeServingsStep({
  timeServings,
  setTimeServings,
}: TimeServingsStepProps) {
  const { theme } = useTheme();
  const { servings, prepTime, cookTime } = timeServings;

  const handleServingsChange = useCallback(
    (delta: number) => {
      const next = clampServings(servings, delta);
      if (next === servings) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeServings({ ...timeServings, servings: next });
    },
    [servings, timeServings, setTimeServings],
  );

  const handlePrepChange = useCallback(
    (text: string) => {
      setTimeServings({
        ...timeServings,
        prepTime: sanitizeMinutesInput(text),
      });
    },
    [timeServings, setTimeServings],
  );

  const handleCookChange = useCallback(
    (text: string) => {
      setTimeServings({
        ...timeServings,
        cookTime: sanitizeMinutesInput(text),
      });
    },
    [timeServings, setTimeServings],
  );

  const totalMinutes = computeTotalMinutes(prepTime, cookTime);
  const servingsAtMin = isServingsAtMin(servings);
  const servingsAtMax = isServingsAtMax(servings);

  const stepperButtonStyle = [
    styles.stepperButton,
    {
      backgroundColor: theme.backgroundSecondary,
      borderColor: withOpacity(theme.link, 0.25),
    },
  ];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Servings stepper */}
      <View style={styles.servingsSection}>
        <Text style={[styles.sectionLabel, { color: theme.link }]}>
          SERVINGS
        </Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => handleServingsChange(-1)}
            disabled={servingsAtMin}
            style={stepperButtonStyle}
            accessibilityRole="button"
            accessibilityLabel="Decrease servings"
            accessibilityValue={{
              now: servings,
              min: MIN_SERVINGS,
              max: MAX_SERVINGS,
              text: `${servings} servings`,
            }}
          >
            <Feather
              name="minus"
              size={20}
              color={servingsAtMin ? withOpacity(theme.link, 0.3) : theme.link}
            />
          </Pressable>

          {/* Decorative number — the +/− buttons carry accessibilityValue, so
              this label is hidden from VoiceOver/TalkBack to prevent double
              announcement. The accessibilityLabel is retained for test queries. */}
          <Text
            style={[styles.servingsNumber, { color: theme.text }]}
            accessibilityLabel={`${servings} servings`}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {servings}
          </Text>

          <Pressable
            onPress={() => handleServingsChange(1)}
            disabled={servingsAtMax}
            style={stepperButtonStyle}
            accessibilityRole="button"
            accessibilityLabel="Increase servings"
            accessibilityValue={{
              now: servings,
              min: MIN_SERVINGS,
              max: MAX_SERVINGS,
              text: `${servings} servings`,
            }}
          >
            <Feather
              name="plus"
              size={20}
              color={servingsAtMax ? withOpacity(theme.link, 0.3) : theme.link}
            />
          </Pressable>
        </View>
      </View>

      {/* Time inputs */}
      <View style={styles.timeRow}>
        {/* Prep Time */}
        <View style={styles.timeCard}>
          <Text style={[styles.sectionLabel, { color: theme.link }]}>
            PREP TIME
          </Text>
          <TextInput
            style={[
              styles.timeInput,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: withOpacity(theme.link, 0.25),
                color: theme.text,
              },
            ]}
            value={prepTime}
            onChangeText={handlePrepChange}
            placeholder="0"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            textAlign="center"
            maxLength={3}
            accessibilityLabel="Prep time in minutes"
            accessibilityHint="Enter prep time in minutes"
          />
          <Text style={[styles.unitText, { color: theme.textSecondary }]}>
            minutes
          </Text>
        </View>

        {/* Cook Time */}
        <View style={styles.timeCard}>
          <Text style={[styles.sectionLabel, { color: theme.link }]}>
            COOK TIME
          </Text>
          <TextInput
            style={[
              styles.timeInput,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: withOpacity(theme.link, 0.25),
                color: theme.text,
              },
            ]}
            value={cookTime}
            onChangeText={handleCookChange}
            placeholder="0"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            textAlign="center"
            maxLength={3}
            accessibilityLabel="Cook time in minutes"
            accessibilityHint="Enter cook time in minutes"
          />
          <Text style={[styles.unitText, { color: theme.textSecondary }]}>
            minutes
          </Text>
        </View>
      </View>

      {/* Total time */}
      {totalMinutes > 0 && (
        <Text style={[styles.totalText, { color: theme.textSecondary }]}>
          Total: {totalMinutes} minutes
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingBottom: Spacing.xl,
    alignItems: "center",
  },
  servingsSection: {
    alignItems: "center",
    marginBottom: Spacing["3xl"],
  },
  sectionLabel: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing["2xl"],
  },
  stepperButton: {
    // iOS HIG + WCAG 2.5.8: 44×44 minimum visible tap target.
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  servingsNumber: {
    fontFamily: FontFamily.bold,
    fontSize: 32,
    minWidth: 48,
    textAlign: "center",
  },
  timeRow: {
    flexDirection: "row",
    gap: Spacing.lg,
    justifyContent: "center",
    width: "100%",
    paddingHorizontal: Spacing.lg,
  },
  timeCard: {
    flex: 1,
    alignItems: "center",
  },
  timeInput: {
    width: "100%",
    height: 64,
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    fontFamily: FontFamily.bold,
    fontSize: 24,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  unitText: {
    fontFamily: FontFamily.regular,
    fontSize: 13,
  },
  totalText: {
    fontFamily: FontFamily.medium,
    fontSize: 14,
    marginTop: Spacing.lg,
    textAlign: "center",
  },
});
