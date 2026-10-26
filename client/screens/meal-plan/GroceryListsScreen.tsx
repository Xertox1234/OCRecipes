import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { StyleSheet, View, Pressable, FlatList, Platform } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { FocusField } from "@/components/FocusField";
import type { FieldFocus } from "@/components/useFieldFocus";
import { LABELLED_INPUT_TEXT } from "@/components/field-focus-utils";
import { useAccessibility } from "@/hooks/useAccessibility";
import { focusTimingConfig } from "@/constants/animations";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeTabBarHeight } from "@/hooks/useSafeTabBarHeight";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { PressableScale } from "@/components/PressableScale";
import { useConfirmationModal } from "@/components/ConfirmationModal";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { toLocalDateString } from "@shared/lib/date";
import {
  useGroceryLists,
  useCreateGroceryList,
  useDeleteGroceryList,
} from "@/hooks/useGroceryList";
import { usePremiumContext } from "@/context/PremiumContext";
import { VERIFICATION_STREAK_UNLOCK_THRESHOLD } from "@shared/types/premium";
import type { GroceryListsScreenNavigationProp } from "@/types/navigation";
import type { MealPlanStackParamList } from "@/navigation/MealPlanStackNavigator";
import type { GroceryList } from "@shared/schema";
import {
  formatDateRange,
  formatDateWithWeekday,
  formatGroceryListTitle,
} from "@/lib/format";
import { useFromHomeBackRedirect } from "@/hooks/useFromHomeBackRedirect";

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * A tappable date drawn through FocusField: shows as focused while its picker
 * is open. There is no text input, so focus is driven by `open`.
 */
function DateField({
  label,
  date,
  open,
  onPress,
}: {
  label: string;
  date: Date;
  open: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withTiming(open ? 1 : 0, {
        ...focusTimingConfig,
        duration: reducedMotion ? 0 : focusTimingConfig.duration,
      }),
    );
  }, [open, reducedMotion, progress]);
  const focus: FieldFocus = {
    focused: open,
    progress,
    onFocus: () => {},
    onBlur: () => {},
  };
  const formatted = formatDateWithWeekday(date);

  return (
    <FocusField
      focus={focus}
      label={label}
      hasValue
      style={[styles.dateInput, { borderColor: withOpacity(theme.text, 0.15) }]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatted}`}
        accessibilityHint="Opens a date picker"
        accessibilityState={{ expanded: open }}
      >
        <ThemedText
          style={[styles.dateValue, LABELLED_INPUT_TEXT, { color: theme.text }]}
        >
          {formatted}
        </ThemedText>
      </Pressable>
    </FocusField>
  );
}

export default function GroceryListsScreen() {
  const navigation = useNavigation<GroceryListsScreenNavigationProp>();
  const route = useRoute<RouteProp<MealPlanStackParamList, "GroceryLists">>();
  useFromHomeBackRedirect(navigation, route.params?.fromHome);
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { confirm, ConfirmationModal, behindContentA11yProps, isOpen } =
    useConfirmationModal();

  // The navigator renders the header as a sibling `behindContentA11yProps`
  // can't reach — hide its back/close control while the sheet is presented
  // so TalkBack/VoiceOver can't swipe past the sheet to it (see
  // todos/archive/P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md).
  // Every navigator (Plan, Profile and Coach stacks) mounts this screen as
  // "GroceryLists", with the native default back button, so the first branch
  // is the one that runs. The `else` branch is a fallback for any other route
  // name: it draws its own close "X" `headerLeft`, as the former root-modal
  // copy "GroceryListsModal" did (removed 2026-10-01 — its list taps were
  // dropped). `setOptions` merges by spreading onto prior override state, so
  // that branch re-renders the Pressable rather than restoring via
  // `headerLeft: undefined`.
  // `headerLeft: () => null` alone is NOT sufficient to hide the native back
  // control on Android here: react-native-screens only computes
  // `hideBackButton` from `headerBackVisible`, and separately derives
  // `backButtonInCustomView` as true whenever `headerTitle` is a function AND
  // `headerLeft` renders null (both true on this route while `isOpen`) —
  // which skips the one statement that would otherwise null the toolbar's
  // navigation icon. `headerBackVisible: false` must be set alongside
  // `headerLeft` in this branch too, not just in the sibling branch above.
  // It must NOT be set to `true` (e.g. via a plain `!isOpen`) in the closed
  // state: `backButtonInCustomView` is `headerBackVisible || (…)`, so an
  // explicit `true` short-circuits it to `true` unconditionally, which skips
  // the native-icon-nulling branch and leaves the native back arrow visible
  // alongside this custom close "X" whenever the sheet is closed (the
  // default, common state) — a duplicate-control regression, not a fix.
  // `undefined` (not the key omitted) is safe here precisely because
  // `headerBackVisible` has no static value on this route for a dynamic
  // `undefined` to permanently shadow — both
  // native reads of it test `=== false` / truthiness, so `undefined`
  // reproduces "never set" exactly.
  useEffect(() => {
    if (route.name === "GroceryLists") {
      navigation.setOptions({ headerBackVisible: !isOpen });
    } else {
      navigation.setOptions({
        headerBackVisible: isOpen ? false : undefined,
        headerLeft: isOpen
          ? () => null
          : () => (
              <Pressable
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                onPress={() => navigation.goBack()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            ),
      });
    }
  }, [isOpen, navigation, route.name, theme.text]);

  const { data: lists, isLoading, isError, refetch } = useGroceryLists();
  const { streakUnlocks } = usePremiumContext();
  const { mutate: createListMutate, isPending: isCreatingList } =
    useCreateGroceryList();
  const { mutate: deleteListMutate } = useDeleteGroceryList();

  const extendedRangeUnlockedByStreak =
    streakUnlocks.includes("extendedPlanRange");

  const [showDatePicker, setShowDatePicker] = useState(false);
  // Dates are held as local `Date`s and become `YYYY-MM-DD` only in the
  // request payload — never parse such a string with `new Date(str)` (UTC).
  // Every date in state is local midnight, so comparisons are by day only.
  const [startDate, setStartDate] = useState(() => startOfLocalDay(new Date()));
  const [endDate, setEndDate] = useState(() => {
    const d = startOfLocalDay(new Date());
    d.setDate(d.getDate() + 6);
    return d;
  });
  // iOS only: which field's inline picker is open (one at a time).
  const [openPicker, setOpenPicker] = useState<"start" | "end" | null>(null);

  const handleDateChange = (which: "start" | "end", raw: Date) => {
    const picked = startOfLocalDay(raw);
    if (which === "start") {
      setStartDate(picked);
      if (picked > endDate) setEndDate(picked);
    } else {
      setEndDate(picked);
    }
  };

  const handleDateFieldPress = (which: "start" | "end") => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: which === "start" ? startDate : endDate,
        mode: "date",
        minimumDate: which === "end" ? startDate : undefined,
        onValueChange: (_event, picked) => handleDateChange(which, picked),
      });
      return;
    }
    setOpenPicker((current) => (current === which ? null : which));
  };

  // Header "+" instead of a floating button (avoids collision with the Scan
  // FAB; same as CookbookListScreen). Declared before the back-button effect
  // above runs so that effect's options stay the last `setOptions` payload.
  // Hidden while the confirm sheet is open, like the back control, so
  // TalkBack/VoiceOver can't reach it behind the sheet.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: isOpen
        ? () => null
        : () => (
            <Pressable
              onPress={() => {
                haptics.impact();
                setShowDatePicker(true);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Generate new grocery list"
              style={({ pressed }) => [
                { marginRight: Spacing.md },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Feather name="plus" size={24} color={theme.link} />
            </Pressable>
          ),
    });
  }, [navigation, haptics, isOpen, theme.link]);

  const handleGenerate = useCallback(() => {
    haptics.impact();
    createListMutate(
      {
        startDate: toLocalDateString(startDate),
        endDate: toLocalDateString(endDate),
      },
      {
        onSuccess: (list) => {
          setShowDatePicker(false);
          setOpenPicker(null);
          navigation.navigate("GroceryList", { listId: list.id });
        },
      },
    );
  }, [haptics, createListMutate, startDate, endDate, navigation]);

  const handleDelete = useCallback(
    (id: number) => {
      confirm({
        title: "Delete List",
        message: "Are you sure you want to delete this list?",
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => deleteListMutate(id),
      });
    },
    [confirm, deleteListMutate],
  );

  const renderItem = useCallback(
    ({ item }: { item: GroceryList }) => (
      <Pressable
        onPress={() => {
          haptics.selection();
          navigation.navigate("GroceryList", { listId: item.id });
        }}
        style={({ pressed }) => [
          styles.listItem,
          { backgroundColor: withOpacity(theme.text, 0.04) },
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={formatGroceryListTitle(item.title)}
      >
        <View style={styles.listItemContent}>
          <ThemedText style={styles.listItemTitle} numberOfLines={1}>
            {formatGroceryListTitle(item.title)}
          </ThemedText>
          <ThemedText
            style={[styles.listItemDate, { color: theme.textSecondary }]}
          >
            {formatDateRange(item.dateRangeStart, item.dateRangeEnd)}
          </ThemedText>
        </View>
        <Pressable
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          onPress={() => handleDelete(item.id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${formatGroceryListTitle(item.title)}`}
        >
          <Feather name="trash-2" size={16} color={theme.textSecondary} />
        </Pressable>
      </Pressable>
    ),
    [theme, haptics, navigation, handleDelete],
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight + Spacing.lg,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
        accessibilityViewIsModal
      >
        <SkeletonProvider>
          <View style={styles.skeletons}>
            {[1, 2, 3].map((i) => (
              <SkeletonBox
                key={i}
                width="100%"
                height={64}
                borderRadius={12}
                style={{ marginBottom: Spacing.md }}
              />
            ))}
          </View>
        </SkeletonProvider>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      accessibilityViewIsModal
    >
      <FlatList
        {...FLATLIST_DEFAULTS}
        {...behindContentA11yProps}
        data={lists || []}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.md,
          paddingHorizontal: Spacing.lg,
          paddingBottom: tabBarHeight + Spacing.xl,
        }}
        ListEmptyComponent={
          isError ? (
            <View style={styles.emptyState}>
              <Feather
                name="alert-circle"
                size={48}
                color={withOpacity(theme.text, 0.2)}
              />
              <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
                Couldn&apos;t load your lists
              </ThemedText>
              <ThemedText
                style={[styles.emptySubtitle, { color: theme.textSecondary }]}
              >
                Something went wrong. Check your connection and try again.
              </ThemedText>
              <PressableScale
                onPress={() => {
                  haptics.impact();
                  void refetch();
                }}
                style={[
                  styles.generateButton,
                  { backgroundColor: theme.accentSolid },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Retry loading grocery lists"
              >
                <ThemedText style={{ color: theme.buttonText }}>
                  Try Again
                </ThemedText>
              </PressableScale>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Feather
                name="shopping-cart"
                size={48}
                color={withOpacity(theme.text, 0.2)}
              />
              <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>
                No Grocery Lists
              </ThemedText>
              <ThemedText
                style={[styles.emptySubtitle, { color: theme.textSecondary }]}
              >
                Generate a list from your planned meals.
              </ThemedText>
            </View>
          )
        }
        ListHeaderComponent={
          showDatePicker ? (
            <View
              style={[
                styles.datePickerCard,
                { backgroundColor: withOpacity(theme.text, 0.04) },
              ]}
            >
              <ThemedText style={styles.datePickerLabel}>Date Range</ThemedText>
              {extendedRangeUnlockedByStreak ? (
                <ThemedText
                  style={[styles.streakUnlockNote, { color: theme.success }]}
                >
                  {`Extended meal planning unlocked by your ${VERIFICATION_STREAK_UNLOCK_THRESHOLD}-day verification streak`}
                </ThemedText>
              ) : null}
              <View style={styles.dateInputRow}>
                <DateField
                  label="Start date"
                  date={startDate}
                  open={openPicker === "start"}
                  onPress={() => handleDateFieldPress("start")}
                />
                <ThemedText style={{ color: theme.textSecondary }}>
                  to
                </ThemedText>
                <DateField
                  label="End date"
                  date={endDate}
                  open={openPicker === "end"}
                  onPress={() => handleDateFieldPress("end")}
                />
              </View>
              {Platform.OS !== "android" && openPicker ? (
                <DateTimePicker
                  value={openPicker === "start" ? startDate : endDate}
                  mode="date"
                  display="inline"
                  minimumDate={openPicker === "end" ? startDate : undefined}
                  onValueChange={(_event, picked) =>
                    handleDateChange(openPicker, picked)
                  }
                />
              ) : null}
              <View style={styles.datePickerActions}>
                <PressableScale
                  onPress={() => {
                    setShowDatePicker(false);
                    setOpenPicker(null);
                  }}
                  style={[styles.cancelButton, { borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <ThemedText style={{ color: theme.textSecondary }}>
                    Cancel
                  </ThemedText>
                </PressableScale>
                <PressableScale
                  onPress={handleGenerate}
                  disabled={isCreatingList}
                  style={[
                    styles.generateButton,
                    {
                      backgroundColor: theme.accentSolid,
                      opacity: isCreatingList ? 0.6 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Generate grocery list"
                >
                  <ThemedText style={{ color: theme.buttonText }}>
                    {isCreatingList ? "Generating..." : "Generate"}
                  </ThemedText>
                </PressableScale>
              </View>
            </View>
          ) : null
        }
      />

      <ConfirmationModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skeletons: {
    padding: Spacing.lg,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.md,
  },
  listItemContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  listItemTitle: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    marginBottom: 2,
  },
  listItemDate: {
    fontSize: 13,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["3xl"],
    paddingHorizontal: Spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: FontFamily.semiBold,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  datePickerCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.lg,
  },
  datePickerLabel: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    marginBottom: Spacing.md,
  },
  streakUnlockNote: {
    fontSize: 13,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.md,
  },
  dateInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
  },
  dateValue: {
    fontSize: 14,
  },
  datePickerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.sm,
  },
  cancelButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  generateButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
});
