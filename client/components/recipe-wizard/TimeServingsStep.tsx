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
      const next = Math.min(99, Math.max(1, servings + delta));
      if (next === servings) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeServings({ ...timeServings, servings: next });
    },
    [servings, timeServings, setTimeServings],
  );

  const handlePrepChange = useCallback(
    (text: string) => {
      const digits = text.replace(/\D/g, "");
      setTimeServings({ ...timeServings, prepTime: digits });
    },
    [timeServings, setTimeServings],
  );

  const handleCookChange = useCallback(
    (text: string) => {
      const digits = text.replace(/\D/g, "");
      setTimeServings({ ...timeServings, cookTime: digits });
    },
    [timeServings, setTimeServings],
  );

  const prepMinutes = parseInt(prepTime, 10) || 0;
  const cookMinutes = parseInt(cookTime, 10) || 0;
  const totalMinutes = prepMinutes + cookMinutes;

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
            disabled={servings <= 1}
            style={stepperButtonStyle}
            accessibilityRole="button"
            accessibilityLabel="Decrease servings"
            hitSlop={8}
          >
            <Feather
              name="minus"
              size={20}
              color={servings <= 1 ? withOpacity(theme.link, 0.3) : theme.link}
            />
          </Pressable>

          <Text
            style={[styles.servingsNumber, { color: theme.text }]}
            accessibilityLabel={`${servings} servings`}
          >
            {servings}
          </Text>

          <Pressable
            onPress={() => handleServingsChange(1)}
            disabled={servings >= 99}
            style={stepperButtonStyle}
            accessibilityRole="button"
            accessibilityLabel="Increase servings"
            hitSlop={8}
          >
            <Feather
              name="plus"
              size={20}
              color={servings >= 99 ? withOpacity(theme.link, 0.3) : theme.link}
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
    width: 36,
    height: 36,
    borderRadius: 18,
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
