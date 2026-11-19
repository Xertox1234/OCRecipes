import React, { useRef } from "react";
import { StyleSheet, View, Pressable } from "react-native";
import Animated, {
  FadeInDown,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { usePressScale } from "@/hooks/usePressScale";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  formatAmount,
  formatTotalsLine,
  isAtMinimum,
  rowAmountLabel,
  rowCaption,
  MAX_ROW_QUANTITY,
  type EntryRow,
  type EntryTotals,
} from "@/components/meal-plan/simple-entry-utils";

const STEPPER_BUTTON = 36;
const ROW_ENTER_MS = 200;
const ROW_EXIT_MS = 150;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface StepperButtonProps {
  icon: "minus" | "plus" | "trash-2";
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

function StepperButton({ icon, label, onPress, disabled }: StepperButtonProps) {
  const { theme } = useTheme();
  const { animatedStyle, onPressIn, onPressOut } = usePressScale(0.9, {
    enabled: !disabled,
  });
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      // 36pt visual, 44pt target.
      hitSlop={4}
      style={[styles.stepperButton, animatedStyle]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather
        name={icon}
        size={icon === "trash-2" ? 16 : 18}
        color={disabled ? withOpacity(theme.text, 0.25) : theme.text}
        accessible={false}
      />
    </AnimatedPressable>
  );
}

interface AmountStepperProps {
  value: string;
  valueTestID?: string;
  decreaseLabel: string;
  increaseLabel: string;
  /** The minus becomes a bin when the next tap down removes the thing. */
  decreaseRemoves?: boolean;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}

/** One pill holding minus, the amount and plus. */
function AmountStepper({
  value,
  valueTestID,
  decreaseLabel,
  increaseLabel,
  decreaseRemoves = false,
  decreaseDisabled = false,
  increaseDisabled = false,
  onDecrease,
  onIncrease,
}: AmountStepperProps) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        styles.stepper,
        { backgroundColor: withOpacity(theme.text, 0.06) },
      ]}
    >
      <StepperButton
        icon={decreaseRemoves ? "trash-2" : "minus"}
        label={decreaseLabel}
        onPress={onDecrease}
        disabled={decreaseDisabled}
      />
      <ThemedText
        testID={valueTestID}
        style={[styles.stepperValue, { color: theme.text }]}
        // The buttons carry the meaning; the row's own text reads the amount.
        accessible={false}
        importantForAccessibility="no"
      >
        {value}
      </ThemedText>
      <StepperButton
        icon="plus"
        label={increaseLabel}
        onPress={onIncrease}
        disabled={increaseDisabled}
      />
    </View>
  );
}

interface FoodRowProps {
  row: EntryRow;
  isLast: boolean;
  onStep: (id: string, direction: 1 | -1) => void;
}

function FoodRow({ row, isLast, onStep }: FoodRowProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const removes = isAtMinimum(row);
  const detail = `${rowAmountLabel(row)} · ${rowCaption(row)}`;
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.duration(ROW_ENTER_MS)}
      exiting={reducedMotion ? undefined : FadeOut.duration(ROW_EXIT_MS)}
      layout={
        reducedMotion ? undefined : LinearTransition.duration(ROW_ENTER_MS)
      }
      style={[
        styles.row,
        !isLast && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <View
        style={styles.rowText}
        accessible
        accessibilityLabel={`${row.name}, ${detail}`}
      >
        <ThemedText
          style={[styles.rowName, { color: theme.text }]}
          numberOfLines={2}
        >
          {row.name}
        </ThemedText>
        <ThemedText style={[styles.rowDetail, { color: theme.textSecondary }]}>
          {detail}
        </ThemedText>
      </View>
      <AmountStepper
        value={formatAmount(row.quantity)}
        decreaseLabel={removes ? `Remove ${row.name}` : `Less ${row.name}`}
        increaseLabel={`More ${row.name}`}
        decreaseRemoves={removes}
        onDecrease={() => onStep(row.id, -1)}
        onIncrease={() => onStep(row.id, 1)}
      />
    </Animated.View>
  );
}

interface SimpleEntryReviewProps {
  title: string;
  mealLabel: string;
  rows: EntryRow[];
  totals: EntryTotals;
  servings: number;
  isAdding: boolean;
  error: string | null;
  onStep: (id: string, direction: 1 | -1) => void;
  onServingsChange: (delta: 1 | -1) => void;
  onEditTitle: () => void;
  onAdd: () => void;
  /** Drinks and sides, shown under the foods. */
  children?: React.ReactNode;
}

/**
 * Step two of Simple Entry: the foods the estimate counted as one serving,
 * each adjustable, with the running total and the Add button pinned below
 * the scrolling list so they are always in reach.
 */
export function SimpleEntryReview({
  title,
  mealLabel,
  rows,
  totals,
  servings,
  isAdding,
  error,
  onStep,
  onServingsChange,
  onEditTitle,
  onAdd,
  children,
}: SimpleEntryReviewProps) {
  const { theme } = useTheme();
  const isEmpty = rows.length === 0;
  // When the list grows (a drink is added, the "something else" field opens)
  // bring the new thing into view. The first layout is not growth.
  const scrollRef =
    useRef<React.ComponentRef<typeof BottomSheetScrollView>>(null);
  const contentHeightRef = useRef<number | null>(null);
  const handleContentSizeChange = (_width: number, height: number) => {
    const previous = contentHeightRef.current;
    contentHeightRef.current = height;
    if (previous != null && height > previous) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  };

  return (
    <View style={styles.container}>
      <BottomSheetScrollView
        ref={scrollRef}
        testID="simple-entry-review-scroll"
        onContentSizeChange={handleContentSizeChange}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={styles.titleRow}>
          <ThemedText type="h4" style={styles.title} numberOfLines={2}>
            {title}
          </ThemedText>
          <Pressable
            onPress={onEditTitle}
            hitSlop={12}
            style={styles.editButton}
            accessibilityRole="button"
            accessibilityLabel="Edit dish name"
          >
            <Feather
              name="edit-2"
              size={14}
              color={theme.link}
              accessible={false}
            />
            <ThemedText style={[styles.editText, { color: theme.link }]}>
              Edit
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText style={[styles.lede, { color: theme.textSecondary }]}>
          {isEmpty
            ? "Nothing left in this entry. Add something below, or edit the dish."
            : "Here's what we counted as one serving. Change anything that isn't how you have it."}
        </ThemedText>

        {!isEmpty && (
          <View
            style={[
              styles.card,
              { backgroundColor: withOpacity(theme.text, 0.04) },
            ]}
          >
            {rows.map((row, index) => (
              <FoodRow
                key={row.id}
                row={row}
                isLast={index === rows.length - 1}
                onStep={onStep}
              />
            ))}
          </View>
        )}

        {children}
      </BottomSheetScrollView>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <View style={styles.totalsRow}>
          <View
            style={styles.totalCalories}
            accessible
            accessibilityLabel={`One serving: ${totals.calories} calories, ${formatTotalsLine(totals)}`}
          >
            <ThemedText
              testID="total-calories"
              style={[styles.totalNumber, { color: theme.text }]}
            >
              {totals.calories}
            </ThemedText>
            <ThemedText
              style={[styles.totalUnit, { color: theme.textSecondary }]}
            >
              kcal per serving
            </ThemedText>
          </View>
          <ThemedText
            style={[styles.macros, { color: theme.textSecondary }]}
            accessible={false}
            importantForAccessibility="no"
          >
            {formatTotalsLine(totals)}
          </ThemedText>
        </View>

        <View style={styles.servingsRow}>
          <ThemedText
            style={[styles.servingsLabel, { color: theme.text }]}
            accessibilityLabel={`Servings on the plan, ${servings}`}
          >
            Servings on the plan
          </ThemedText>
          <AmountStepper
            value={String(servings)}
            valueTestID="servings-value"
            decreaseLabel="Decrease servings"
            increaseLabel="Increase servings"
            decreaseDisabled={servings <= 1}
            increaseDisabled={servings >= MAX_ROW_QUANTITY}
            onDecrease={() => onServingsChange(-1)}
            onIncrease={() => onServingsChange(1)}
          />
        </View>

        <InlineError message={error} style={styles.error} />

        <Button
          onPress={onAdd}
          disabled={isEmpty}
          loading={isAdding}
          loadingText="Adding…"
        >
          {`Add to ${mealLabel}`}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  title: {
    flex: 1,
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  editText: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
  },
  lede: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  card: {
    borderRadius: BorderRadius.card,
    paddingHorizontal: Spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    textTransform: "capitalize",
  },
  rowDetail: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.full,
  },
  stepperButton: {
    width: STEPPER_BUTTON,
    height: STEPPER_BUTTON,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    minWidth: 34,
    textAlign: "center",
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
    fontVariant: ["tabular-nums"],
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalsRow: {
    marginBottom: Spacing.sm,
  },
  totalCalories: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
  },
  totalNumber: {
    fontSize: 32,
    lineHeight: 38,
    fontFamily: FontFamily.bold,
    fontVariant: ["tabular-nums"],
  },
  totalUnit: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
  macros: {
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  servingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  servingsLabel: {
    fontSize: 15,
    fontFamily: FontFamily.medium,
  },
  error: {
    marginBottom: Spacing.sm,
  },
});
