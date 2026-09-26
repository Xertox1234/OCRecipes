import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  InteractionManager,
  Platform,
  StyleSheet,
  View,
  Pressable,
  ScrollView,
  RefreshControl,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { RecipeAllergenLabel } from "@/components/RecipeAllergenLabel";
import { toRecipeAllergenA11ySuffix } from "@/components/recipe-allergen-label-utils";
import { SwipeableRow } from "@/components/SwipeableRow";
import { DraggableList } from "@/components/DraggableList";
import { CalorieRing } from "@/components/CalorieRing";
import { EmptyState } from "@/components/EmptyState";
import {
  SkeletonBox,
  SkeletonLoadingRegion,
  SkeletonProvider,
} from "@/components/SkeletonLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { MealSuggestionsModal } from "@/components/MealSuggestionsModal";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { useAccessibility } from "@/hooks/useAccessibility";
import { usePremiumContext } from "@/context/PremiumContext";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
  FAB_CLEARANCE,
} from "@/constants/theme";
import { dateStripSwipeThreshold } from "@/constants/animations";
import {
  MEAL_LABELS,
  computeItemMacros,
  computeMealSectionSummary,
  formatMacroLine,
  getAutoExpandedMealType,
} from "./meal-plan-utils";
import {
  useMealPlanItems,
  useRemoveMealPlanItem,
  useReorderMealPlanItems,
  invalidateMealPlanItems,
  useAddMealPlanItem,
  useConfirmMealPlanItem,
} from "@/hooks/useMealPlan";
import { useDailyBudget } from "@/hooks/useDailyBudget";
import { useSheetBackHandler } from "@/hooks/useSheetBackHandler";
import { useSheetHostProps } from "@/hooks/useSheetHostProps";
import { apiRequest } from "@/lib/query-client";
import { getDeviceTimezone } from "@/lib/timezone";
import { useCreateMealPlanRecipe } from "@/hooks/useMealPlanRecipes";
import { useExpiringPantryItems } from "@/hooks/usePantry";
import {
  QuickAddSheetContent,
  QUICK_ADD_SNAP_POINTS,
  type QuickAddSheetContentHandle,
} from "@/components/meal-plan/QuickAddSheet";
import {
  AddItemMenuSheetContent,
  ADD_ITEM_MENU_SNAP_POINTS,
} from "@/components/meal-plan/AddItemMenuSheet";
import {
  ImportRecipeSheetContent,
  IMPORT_RECIPE_SNAP_POINTS,
} from "@/components/meal-plan/ImportRecipeSheet";
import {
  SimpleEntrySheetContent,
  SIMPLE_ENTRY_SNAP_POINTS,
  type SimpleEntrySheetContentHandle,
} from "@/components/meal-plan/SimpleEntrySheet";
import type { MealPlanHomeScreenNavigationProp } from "@/types/navigation";
import type { DailySummaryResponse } from "@/types/api";
import type { MealPlanItemWithRelations } from "@shared/types/meal-plan";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
// Device-LOCAL basis: `planned_date` must be the day the user tapped on the
// date strip, which is derived from local component getters below
// (`setHours(0,0,0,0)`, `getDate()`). `toDateString` (UTC) would key a
// UTC-positive device one calendar day earlier than its own chip label.
import { toLocalDateString } from "@shared/lib/date";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
type MealType = (typeof MEAL_TYPES)[number];

// The 4 bottom sheets this screen hosts, collapsed into one union so at most
// one can ever be "active" at a time (matches production reality — the app
// never opens two of these simultaneously).
type SheetKind = "addItemMenu" | "importRecipe" | "quickAdd" | "simpleEntry";
type ActiveSheet = { kind: SheetKind; mealType: MealType } | null;

interface TopAction {
  id: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  badgeCount?: number;
}
const MEAL_ICONS: Record<MealType, string> = {
  breakfast: "sunrise",
  lunch: "sun",
  dinner: "moon",
  snack: "coffee",
};

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getDayLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// ── Date Strip Item ──────────────────────────────────────────────────

const DateStripItem = React.memo(function DateStripItem({
  date,
  isSelected,
  hasItems,
  onPress,
}: {
  date: Date;
  isSelected: boolean;
  hasItems: boolean;
  onPress: (date: Date) => void;
}) {
  const { theme } = useTheme();
  const dayName = date
    .toLocaleDateString("en-US", { weekday: "short" })
    .charAt(0);
  const dayNum = date.getDate();

  return (
    <Pressable
      onPress={() => onPress(date)}
      style={[
        styles.dateStripItem,
        {
          backgroundColor: isSelected
            ? theme.accentSolid
            : withOpacity(theme.text, 0.05),
        },
      ]}
      accessibilityRole="button"
      // Selection is state, not label content — accessibilityState below is
      // what VoiceOver/TalkBack use to announce "selected"; appending it to
      // the label too caused a double announcement.
      accessibilityLabel={date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
      accessibilityState={{ selected: isSelected }}
    >
      <ThemedText
        style={[
          styles.dateStripDayName,
          { color: isSelected ? theme.buttonText : theme.textSecondary },
        ]}
      >
        {dayName}
      </ThemedText>
      <ThemedText
        style={[
          styles.dateStripDayNum,
          { color: isSelected ? theme.buttonText : theme.text },
        ]}
      >
        {dayNum}
      </ThemedText>
      {hasItems && !isSelected && (
        <View
          style={[styles.dateStripDot, { backgroundColor: theme.accentSolid }]}
        />
      )}
    </Pressable>
  );
});

// ── Meal Slot Card ───────────────────────────────────────────────────

export const MealSlotItem = React.memo(function MealSlotItem({
  item,
  isConfirmed,
  onPress,
  onRemove,
  onConfirm,
  canConfirm,
}: {
  item: MealPlanItemWithRelations;
  isConfirmed: boolean;
  onPress: (item: MealPlanItemWithRelations) => void;
  onRemove: (id: number) => void;
  onConfirm: (id: number) => void;
  canConfirm: boolean;
}) {
  const { theme } = useTheme();
  const isOrphaned =
    !item.recipe && !item.scannedItem && !item.recipeId && !item.scannedItemId;
  const name = isOrphaned
    ? "Item removed"
    : item.recipe?.title || item.scannedItem?.productName || "Unknown item";
  const macros = isOrphaned ? null : computeItemMacros(item);
  const macroLine = macros ? formatMacroLine(macros) : null;

  // Scanned items carry no derived-allergen cache (that's product-level data,
  // a separate concept) — only a recipe-backed item can have one. The card
  // Pressable is accessible by default, which collapses its whole subtree
  // into a single iOS VoiceOver focus stop (device-verified: an RN
  // accessible={true} wrapper collapses its subtree on iOS but NOT on
  // Android — see docs/solutions/best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md
  // item 9), so fold the allergen text into the card's own label (same
  // pattern as RecipeBrowserScreen's UnifiedRecipeCard) rather than relying
  // on the nested label's own container.
  const allergenA11ySuffix = toRecipeAllergenA11ySuffix(item.recipe?.allergens);

  const accessLabel = macros
    ? `${name}, ${macros.calories} calories, ${macros.protein}g protein, ${macros.carbs}g carbs, ${macros.fat}g fat${isConfirmed ? ", confirmed" : ""}${allergenA11ySuffix}`
    : `${name}${isConfirmed ? ", confirmed" : ""}${allergenA11ySuffix}`;

  // The card Pressable above is accessible by default, which collapses its
  // whole subtree into a single iOS VoiceOver focus stop (same device-verified
  // iOS-only collapse cited above) — the nested Confirm and Remove Pressables
  // below are never independently reachable on iOS VoiceOver (Android keeps
  // them independently reachable regardless — see the same citation).
  // Expose both as accessibilityActions on the card instead (additive/
  // harmless on Android; same pattern as CarouselRecipeCard's
  // toggleFavourite/dismiss actions) so the primary
  // label stays the single focus stop while Confirm/Remove are still
  // independently activatable via the screen reader's actions/rotor. Confirm
  // is omitted once there's nothing left to confirm (mirrors `canConfirm`
  // gating the nested button's render + the `!isConfirmed &&` guard on its
  // onPress); Remove has no such gate, matching its unconditional render.
  const accessibilityActions = useMemo(
    () => [
      ...(canConfirm && !isConfirmed
        ? [{ name: "confirm", label: `Confirm ${name} as eaten` }]
        : []),
      { name: "remove", label: `Remove ${name}` },
    ],
    [canConfirm, isConfirmed, name],
  );

  const handleAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "confirm") {
        if (!isConfirmed) onConfirm(item.id);
      } else if (event.nativeEvent.actionName === "remove") {
        onRemove(item.id);
      }
    },
    [isConfirmed, onConfirm, onRemove, item.id],
  );

  return (
    <Pressable
      onPress={() => !isOrphaned && onPress(item)}
      style={[
        styles.mealSlotItem,
        {
          backgroundColor: isOrphaned
            ? withOpacity(theme.text, 0.02)
            : isConfirmed
              ? withOpacity(theme.success, 0.08)
              : withOpacity(theme.text, 0.04),
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessLabel}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={handleAccessibilityAction}
    >
      {canConfirm && (
        <Pressable
          onPress={() => !isConfirmed && onConfirm(item.id)}
          style={{
            width: 44,
            height: 44,
            justifyContent: "center",
            alignItems: "center",
            marginRight: Spacing.sm,
          }}
          accessibilityRole="button"
          accessibilityLabel={
            isConfirmed ? `${name} confirmed` : `Confirm ${name} as eaten`
          }
          disabled={isConfirmed}
        >
          <Feather
            name={isConfirmed ? "check-circle" : "circle"}
            size={20}
            color={isConfirmed ? theme.success : theme.textSecondary}
          />
        </Pressable>
      )}
      <View style={styles.mealSlotContent}>
        <ThemedText
          style={[
            styles.mealSlotName,
            isOrphaned && { color: theme.textSecondary, fontStyle: "italic" },
          ]}
          numberOfLines={1}
        >
          {name}
        </ThemedText>
        <RecipeAllergenLabel allergens={item.recipe?.allergens} />
        {macroLine !== null && (
          <ThemedText
            style={[styles.mealSlotCalories, { color: theme.textSecondary }]}
          >
            {macroLine}
          </ThemedText>
        )}
      </View>
      <Pressable
        onPress={() => onRemove(item.id)}
        style={{
          width: 44,
          height: 44,
          justifyContent: "center",
          alignItems: "center",
        }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
      >
        <Feather name="x" size={16} color={theme.textSecondary} />
      </Pressable>
    </Pressable>
  );
});

// ── Meal Slot Section ────────────────────────────────────────────────

export const MealSlotSection = React.memo(function MealSlotSection({
  mealType,
  items,
  confirmedIds,
  onItemPress,
  onRemoveItem,
  onAddItem,
  onSuggest,
  onConfirmItem,
  onReorder,
  canSuggest,
  canConfirm,
  isExpanded,
  onToggle,
  sectionSummary,
}: {
  mealType: MealType;
  items: MealPlanItemWithRelations[];
  confirmedIds: Set<number>;
  onItemPress: (item: MealPlanItemWithRelations) => void;
  onRemoveItem: (id: number) => void;
  onAddItem: (mealType: MealType) => void;
  onSuggest: (mealType: MealType) => void;
  onConfirmItem: (id: number) => void;
  onReorder?: (items: MealPlanItemWithRelations[]) => void;
  canSuggest: boolean;
  canConfirm: boolean;
  isExpanded: boolean;
  onToggle: (mealType: MealType) => void;
  sectionSummary: { itemCount: number; totalCalories: number };
}) {
  const { theme } = useTheme();
  const iconName = MEAL_ICONS[mealType] || "circle";
  const label = MEAL_LABELS[mealType] || mealType;

  const summaryText =
    sectionSummary.itemCount > 0
      ? ` \u00B7 ${sectionSummary.itemCount} item${sectionSummary.itemCount !== 1 ? "s" : ""} \u00B7 ${sectionSummary.totalCalories} cal`
      : "";

  const headerAccessLabel = isExpanded
    ? `${label}, expanded`
    : `${label}${summaryText}, collapsed`;

  // The header Pressable is accessible by default, which collapses its whole
  // subtree into a single iOS VoiceOver focus stop (device-verified: an RN
  // accessible={true} wrapper collapses its subtree on iOS but NOT on
  // Android — see docs/solutions/best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md
  // item 9) — the nested "Suggest" chip below is never independently
  // reachable on iOS VoiceOver when the section is expanded (Android keeps
  // it independently reachable regardless). Expose it as an
  // accessibilityAction on the header instead (additive/harmless on
  // Android; same pattern as CarouselRecipeCard's toggleFavourite/dismiss
  // actions), gated to
  // isExpanded since that's also what gates the chip's own render — a
  // collapsed section has no Suggest chip to route the action to.
  const headerAccessibilityActions = useMemo(
    () =>
      isExpanded
        ? [
            {
              name: "suggest",
              label: canSuggest
                ? `AI suggest ${label.toLowerCase()}`
                : `Upgrade to suggest ${label.toLowerCase()}`,
            },
          ]
        : undefined,
    [isExpanded, canSuggest, label],
  );

  const handleHeaderAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "suggest") {
        onSuggest(mealType);
      }
    },
    [onSuggest, mealType],
  );

  return (
    <View style={styles.mealSlotSection}>
      <Pressable
        onPress={() => onToggle(mealType)}
        style={styles.mealSlotHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={headerAccessLabel}
        accessibilityActions={headerAccessibilityActions}
        onAccessibilityAction={handleHeaderAccessibilityAction}
      >
        <Feather
          name={iconName as keyof typeof Feather.glyphMap}
          size={16}
          color={theme.link}
        />
        <ThemedText style={[styles.mealSlotLabel, { flex: 1 }]}>
          {label}
          {!isExpanded && summaryText ? (
            <ThemedText
              style={[styles.collapsedSummary, { color: theme.textSecondary }]}
            >
              {summaryText}
            </ThemedText>
          ) : null}
        </ThemedText>
        {isExpanded && (
          <Pressable
            onPress={() => onSuggest(mealType)}
            hitSlop={8}
            style={[
              styles.suggestChip,
              {
                backgroundColor: canSuggest
                  ? withOpacity(theme.link, 0.1)
                  : withOpacity(theme.text, 0.05),
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              canSuggest
                ? `AI suggest ${label.toLowerCase()}`
                : `Upgrade to suggest ${label.toLowerCase()}`
            }
          >
            <Feather
              name={canSuggest ? "zap" : "lock"}
              size={12}
              color={canSuggest ? theme.link : theme.textSecondary}
            />
            <ThemedText
              style={[
                styles.suggestChipText,
                {
                  color: canSuggest ? theme.link : theme.textSecondary,
                },
              ]}
            >
              Suggest
            </ThemedText>
          </Pressable>
        )}
        <Feather
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={theme.textSecondary}
          style={{ marginLeft: Spacing.sm }}
        />
      </Pressable>
      {isExpanded && (
        <View>
          {items.length > 1 && onReorder ? (
            <DraggableList
              items={items}
              keyExtractor={(item) => item.id}
              renderItem={(item) => (
                <SwipeableRow
                  rightAction={{
                    icon: "trash-2",
                    label: "Remove",
                    backgroundColor: theme.error,
                    onAction: () => onRemoveItem(item.id),
                  }}
                >
                  <MealSlotItem
                    item={item}
                    isConfirmed={confirmedIds.has(item.id)}
                    onPress={onItemPress}
                    onRemove={onRemoveItem}
                    onConfirm={onConfirmItem}
                    canConfirm={canConfirm}
                  />
                </SwipeableRow>
              )}
              onReorder={onReorder}
            />
          ) : (
            items.map((item) => (
              <SwipeableRow
                key={item.id}
                rightAction={{
                  icon: "trash-2",
                  label: "Remove",
                  backgroundColor: theme.error,
                  onAction: () => onRemoveItem(item.id),
                }}
              >
                <MealSlotItem
                  item={item}
                  isConfirmed={confirmedIds.has(item.id)}
                  onPress={onItemPress}
                  onRemove={onRemoveItem}
                  onConfirm={onConfirmItem}
                  canConfirm={canConfirm}
                />
              </SwipeableRow>
            ))
          )}
          <Pressable
            onPress={() => onAddItem(mealType)}
            style={[
              styles.addItemButton,
              { borderColor: withOpacity(theme.text, 0.1) },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${label.toLowerCase()} item`}
          >
            <Feather name="plus" size={16} color={theme.link} />
            <ThemedText style={[styles.addItemText, { color: theme.link }]}>
              {`Add ${label.toLowerCase()} item`}
            </ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
});

// ── CalorieRing replaces DailyTotals + Empty State ──────────────────

// ── Main Screen ──────────────────────────────────────────────────────

// Free: 7 days forward, Premium: 90 days forward
const FREE_MAX_DAYS_FORWARD = 7;
const PREMIUM_MAX_DAYS_FORWARD = 90;

export default function MealPlanHomeScreen() {
  const navigation = useNavigation<MealPlanHomeScreenNavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { features, isPremium } = usePremiumContext();
  const { reducedMotion } = useAccessibility();

  const dateStripTranslateX = useSharedValue(0);

  // BottomSheetModal must be declared directly in this screen component —
  // declaring it inside an imported child component silently breaks
  // .present() (no error, no onChange/onAnimate, no visual change). See
  // docs/solutions for the root-cause writeup. Each child below only owns
  // its content; this screen owns the modal + its ref/effect.
  const addItemMenuSheetRef = useRef<BottomSheetModal>(null);
  const importRecipeSheetRef = useRef<BottomSheetModal>(null);
  const quickAddSheetRef = useRef<BottomSheetModal>(null);
  const quickAddSheetContentRef = useRef<QuickAddSheetContentHandle>(null);
  const simpleEntrySheetRef = useRef<BottomSheetModal>(null);
  const simpleEntrySheetContentRef =
    useRef<SimpleEntrySheetContentHandle>(null);

  // Shared host prop bundle for all 4 sheets below (backdrop, themed
  // background, hidden handle, and the accessible={false} iOS a11y fix —
  // see useSheetHostProps' own JSDoc). BottomSheetModal's own background
  // defaults to white regardless of theme, so it must be themed explicitly.
  const sheetHostProps = useSheetHostProps({
    backgroundColor: theme.backgroundDefault,
    backdropOpacity: 0.35,
    backdropPressBehavior: "close",
  });

  const [today, setToday] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  // Update 'today' when screen comes into focus (handles midnight crossing)
  useFocusEffect(
    useCallback(() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (d.getTime() !== today.getTime()) {
        setToday(d);
      }
    }, [today]),
  );

  const [selectedDate, setSelectedDate] = useState(today);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [suggestModalVisible, setSuggestModalVisible] = useState(false);
  const [suggestMealType, setSuggestMealType] = useState<MealType>("breakfast");
  const [expandedSections, setExpandedSections] = useState<Set<MealType>>(
    () => new Set([getAutoExpandedMealType()]),
  );
  // One union replaces the 4 hand-duplicated xxxMealType atoms — at most one
  // sheet is ever active. Each kind's own local (addItemMenuMealType, etc.)
  // is derived below so the rest of this component (memoized children,
  // effects) reads the same names it always has.
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const addItemMenuMealType =
    activeSheet?.kind === "addItemMenu" ? activeSheet.mealType : null;
  const importRecipeMealType =
    activeSheet?.kind === "importRecipe" ? activeSheet.mealType : null;
  const quickAddMealType =
    activeSheet?.kind === "quickAdd" ? activeSheet.mealType : null;
  const simpleEntryMealType =
    activeSheet?.kind === "simpleEntry" ? activeSheet.mealType : null;

  // Opens/closes a sheet by kind. `closeSheet` is guarded (only clears when
  // its OWN kind is still active) because gorhom's `onDismiss` fires on
  // close-ANIMATION-complete, which is not guaranteed to run strictly before
  // the destination sheet's InteractionManager-scheduled open during a
  // same-screen handoff (e.g. `handleChooseRecipe` below) — an unguarded
  // `setActiveSheet(null)` from a late-firing onDismiss would clobber the
  // sheet that opened in the meantime.
  const openSheet = useCallback((kind: SheetKind, mealType: MealType) => {
    setActiveSheet({ kind, mealType });
  }, []);
  const closeSheet = useCallback((kind: SheetKind) => {
    setActiveSheet((prev) => (prev?.kind === kind ? null : prev));
  }, []);

  // Android TalkBack background focus trap (iOS already trapped via
  // accessibilityViewIsModal on each sheet's own content root, PR #1000).
  // Applied to the screen's own background ScrollView while ANY sheet is
  // active; releases as soon as activeSheet clears to null (see
  // docs/solutions/logic-errors/
  // gorhom-onchange-fires-on-animation-complete-not-start-2026-07-07.md for
  // why that can be a little ahead of the close animation finishing — the
  // accepted early-release direction, not the never-releases one).
  const isAnySheetOpen = activeSheet !== null;

  const selectedDateStr = toLocalDateString(selectedDate);

  // Destructure rather than depend on the mutation objects themselves —
  // useMutation returns a new object identity every render, which would
  // make every useCallback below that depends on it re-create every render
  // (and, since those callbacks feed the memoized MealSlotSection/
  // MealSlotItem rows, defeat their React.memo). See CoachChat.tsx for the
  // same pattern.
  const { mutateAsync: createRecipe } = useCreateMealPlanRecipe();
  const { mutateAsync: addMealPlanItem } = useAddMealPlanItem();
  const { mutate: confirmItem } = useConfirmMealPlanItem();
  const { data: expiringItems } = useExpiringPantryItems(
    features.pantryTracking,
  );

  // Fetch daily summary for confirmed meal plan item IDs
  const { data: dailySummaryData } = useQuery<DailySummaryResponse>({
    queryKey: ["/api/daily-summary", selectedDateStr],
    queryFn: async () => {
      // apiRequest throws on non-2xx (throwIfResNotOk), so no manual !res.ok guard.
      const res = await apiRequest(
        "GET",
        `/api/daily-summary?date=${selectedDateStr}`,
        undefined,
        { headers: { "X-Timezone": getDeviceTimezone() } },
      );
      return res.json();
    },
  });

  const confirmedIds = useMemo(
    () => new Set(dailySummaryData?.confirmedMealPlanItemIds ?? []),
    [dailySummaryData?.confirmedMealPlanItemIds],
  );

  const maxDaysForward = isPremium
    ? PREMIUM_MAX_DAYS_FORWARD
    : FREE_MAX_DAYS_FORWARD;

  // Generate 7-day date range centered on selected week
  const weekDates = useMemo(() => {
    // Start from the selected date's week start (Sunday)
    const weekStart = new Date(selectedDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [selectedDate]);

  const startDate = toLocalDateString(weekDates[0]);
  const endDate = toLocalDateString(weekDates[6]);

  const {
    data: mealPlanItems,
    isLoading,
    isRefetching,
    isLoadingError,
    refetch: refetchMealPlanItems,
  } = useMealPlanItems(startDate, endDate);

  const { mutate: removeItem } = useRemoveMealPlanItem();
  const { mutate: reorderItems } = useReorderMealPlanItems();

  // Group items by date and meal type
  const dayItems = useMemo(() => {
    if (!mealPlanItems) return {};
    const grouped: Record<string, MealPlanItemWithRelations[]> = {};
    for (const item of mealPlanItems) {
      const key = item.plannedDate;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    }
    return grouped;
  }, [mealPlanItems]);

  const selectedDayItems = useMemo(
    () => dayItems[selectedDateStr] || [],
    [dayItems, selectedDateStr],
  );

  const itemsByMealType = useMemo(() => {
    const grouped: Record<string, MealPlanItemWithRelations[]> = {};
    for (const mealType of MEAL_TYPES) {
      grouped[mealType] = selectedDayItems.filter(
        (i) => i.mealType === mealType,
      );
    }
    return grouped;
  }, [selectedDayItems]);

  const sectionSummaries = useMemo(() => {
    const result: Record<string, { itemCount: number; totalCalories: number }> =
      {};
    for (const mealType of MEAL_TYPES) {
      result[mealType] = computeMealSectionSummary(
        itemsByMealType[mealType] || [],
      );
    }
    return result;
  }, [itemsByMealType]);

  // Calorie ring data
  const {
    data: budgetData,
    isError: budgetError,
    refetch: refetchBudget,
  } = useDailyBudget(selectedDateStr);
  const calorieGoal = budgetData?.calorieGoal ?? 2000;

  // Suppress the 2000 default against a failed budget fetch, so we don't show a
  // confident-wrong goal. This is the same condition that renders the error
  // EmptyState below (not `budgetError` alone) — with stale cached data we keep
  // showing the ring, so the announce must track the no-data error only.
  const budgetErrorNoData = budgetError && !budgetData;

  // Announce each error EmptyState for screen readers — neither has a live
  // region, so a cross-platform announce carries both VoiceOver and TalkBack
  // with no double-announce. Both are EDGE-triggered on the error itself
  // (announce on the rise, re-arm only when the error clears), never a
  // re-test of state on every deps change: TanStack resets a data-less query
  // to pending/error:null on refetch, so a state re-test re-announced on
  // unrelated transitions (e.g. the budget copy on every items Try Again).
  // The refs start at their mount value, so a screen that opens already
  // errored does not announce on top of initial focus.
  //
  // Budget: its EmptyState is hidden while the full-screen items skeleton is
  // up (`isLoading`), so the announce is deferred until it is actually on
  // screen. The skeleton covering it is not "clearing" — only
  // budgetErrorNoData falling re-arms it. Items: rendered in the scroll
  // content on isLoadingError (see below); isLoading and isLoadingError are
  // mutually exclusive, so it needs no skeleton gate.
  //
  // ONE effect for both: they can rise in the same commit (a shared outage,
  // or items failing while a skeleton-deferred budget error waits), and iOS
  // drops the second of two same-commit announcements — so a joint rise is
  // spoken as one combined utterance.
  const budgetErrorAnnouncedRef = useRef(budgetErrorNoData && !isLoading);
  const mealPlanErrorAnnouncedRef = useRef(isLoadingError);
  useEffect(() => {
    if (!budgetErrorNoData) budgetErrorAnnouncedRef.current = false;
    if (!isLoadingError) mealPlanErrorAnnouncedRef.current = false;
    const budgetRose =
      budgetErrorNoData && !isLoading && !budgetErrorAnnouncedRef.current;
    const itemsRose = isLoadingError && !mealPlanErrorAnnouncedRef.current;
    if (budgetRose) budgetErrorAnnouncedRef.current = true;
    if (itemsRose) mealPlanErrorAnnouncedRef.current = true;
    if (budgetRose && itemsRose) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load your meal plan or calorie budget. Try again.",
      );
    } else if (budgetRose) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load your calorie budget. Try again.",
      );
    } else if (itemsRose) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load your meal plan. Try again.",
      );
    }
  }, [budgetErrorNoData, isLoading, isLoadingError]);

  // Tell screen-reader users the screen is loading. Delayed 500ms to match
  // the modal-safe pattern (docs/solutions/conventions/on-open-announce-
  // must-delay-past-modal-present-focus-shift-2026-06-25.md) even though
  // this route isn't a modal — harmless here, and keeps the announce shape
  // identical across every skeleton screen fixed alongside this one.
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility("Loading");
    }, 500);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const dailyTotals = useMemo(() => {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fat = 0;
    for (const item of selectedDayItems) {
      const macros = computeItemMacros(item);
      if (macros) {
        calories += macros.calories;
        protein += macros.protein;
        carbs += macros.carbs;
        fat += macros.fat;
      }
    }
    return { calories, protein, carbs, fat };
  }, [selectedDayItems]);

  const handleDatePress = useCallback(
    (date: Date) => {
      haptics.selection();
      setSelectedDate(date);
    },
    [haptics],
  );

  const handlePrevWeek = useCallback(() => {
    haptics.selection();
    setSelectedDate((prev) => addDays(prev, -7));
  }, [haptics]);

  const handleNextWeek = useCallback(() => {
    const nextWeek = addDays(selectedDate, 7);
    const daysForward = Math.round(
      (nextWeek.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysForward > maxDaysForward) {
      haptics.notification(Haptics.NotificationFeedbackType.Warning);
      setShowUpgradeModal(true);
      return;
    }
    haptics.selection();
    setSelectedDate(nextWeek);
  }, [haptics, selectedDate, today, maxDaysForward]);

  const handleItemPress = useCallback(
    (item: MealPlanItemWithRelations) => {
      if (item.recipeId) {
        navigation.navigate("FeaturedRecipeDetail", {
          recipeId: item.recipeId,
          recipeType: "mealPlan",
        });
      }
    },
    [navigation],
  );

  const handleRemoveItem = useCallback(
    (id: number) => {
      haptics.selection();
      removeItem(id, {
        onError: () =>
          toast.error("Couldn't remove the item. Please try again."),
      });
    },
    [removeItem, haptics, toast],
  );

  const handleReorder = useCallback(
    (reorderedItems: MealPlanItemWithRelations[]) => {
      const updates = reorderedItems.map((item, idx) => ({
        id: item.id,
        sortOrder: idx,
      }));
      reorderItems(updates, {
        onError: () =>
          toast.error("Couldn't save the new order. Please try again."),
      });
    },
    [reorderItems, toast],
  );

  const handleToggleSection = useCallback(
    (mealType: MealType) => {
      haptics.selection();
      setExpandedSections((prev) => {
        const next = new Set(prev);
        const nowExpanded = !next.has(mealType);
        if (nowExpanded) {
          next.add(mealType);
        } else {
          next.delete(mealType);
        }
        if (Platform.OS === "ios") {
          const label = MEAL_LABELS[mealType];
          AccessibilityInfo.announceForAccessibility(
            `${label} ${nowExpanded ? "expanded" : "collapsed"}`,
          );
        }
        return next;
      });
    },
    [haptics],
  );

  const handleAddItem = useCallback(
    (mealType: MealType) => {
      haptics.selection();
      openSheet("addItemMenu", mealType);
    },
    [haptics, openSheet],
  );

  const handleAddItemMenuDismiss = useCallback(() => {
    closeSheet("addItemMenu");
  }, [closeSheet]);

  const handleChooseRecipe = useCallback(() => {
    const mt = addItemMenuMealType;
    closeSheet("addItemMenu");
    InteractionManager.runAfterInteractions(() => {
      if (mt !== null) openSheet("quickAdd", mt);
    });
  }, [addItemMenuMealType, closeSheet, openSheet]);

  const handleSimpleEntry = useCallback(() => {
    const mt = addItemMenuMealType;
    closeSheet("addItemMenu");
    InteractionManager.runAfterInteractions(() => {
      if (mt !== null) openSheet("simpleEntry", mt);
    });
  }, [addItemMenuMealType, closeSheet, openSheet]);

  const handleQuickAddDismiss = useCallback(() => {
    closeSheet("quickAdd");
  }, [closeSheet]);

  const handleSimpleEntryDismiss = useCallback(() => {
    closeSheet("simpleEntry");
  }, [closeSheet]);

  const handleImportRecipe = useCallback(() => {
    const mt = addItemMenuMealType;
    closeSheet("addItemMenu");
    InteractionManager.runAfterInteractions(() => {
      if (mt !== null) openSheet("importRecipe", mt);
    });
  }, [addItemMenuMealType, closeSheet, openSheet]);

  const handleImportRecipeDismiss = useCallback(() => {
    closeSheet("importRecipe");
  }, [closeSheet]);

  // Stable lookup from kind to its own BottomSheetModal ref — refs never
  // change identity, so this object literal (recreated per render) still
  // resolves the same 4 targets every time; no memoization needed.
  const sheetRefs: Record<
    SheetKind,
    React.RefObject<BottomSheetModal | null>
  > = {
    addItemMenu: addItemMenuSheetRef,
    importRecipe: importRecipeSheetRef,
    quickAdd: quickAddSheetRef,
    simpleEntry: simpleEntrySheetRef,
  };

  // The ref the unified back-handler below should dismiss. Only ever
  // reassigned when a sheet OPENS (never cleared on close) — mirrors
  // useSheetBackHandler's own asymmetric isOpenRef bias, so a back press
  // during a close animation still targets the sheet the user can still see.
  const activeSheetRef = useRef<BottomSheetModal | null>(null);
  const prevSheetKindRef = useRef<SheetKind | null>(null);

  // ONE present/dismiss effect for all 4 sheets, replacing the 4
  // near-identical per-kind effects above. Dismisses only the PREVIOUSLY
  // active kind (not every other kind on every change) so this fires exactly
  // like the 4 independent effects it replaces: one dismiss (closing) plus
  // one present (opening) per transition, not a dismiss on every sibling.
  useEffect(() => {
    const kind = activeSheet?.kind ?? null;
    const prevKind = prevSheetKindRef.current;
    if (prevKind && prevKind !== kind) {
      sheetRefs[prevKind].current?.dismiss();
    }
    if (kind) {
      activeSheetRef.current = sheetRefs[kind].current;
      sheetRefs[kind].current?.present();
    }
    prevSheetKindRef.current = kind;
    // sheetRefs' values are stable useRef objects (see the comment above) —
    // only `activeSheet` itself needs to be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSheet]);

  // Android hardware back dismisses whichever sheet is active, consuming the
  // event instead of popping the screen underneath — @gorhom/bottom-sheet has
  // no built-in BackHandler wiring. ONE call for all 4 sheets: `activeSheetRef`
  // (assigned by the present/dismiss effect above) always points at whichever
  // of the 4 real refs is currently active, and `activeSheet !== null` is the
  // isOpen signal. The returned onSheetChange/onSheetAnimate are wired onto
  // every <BottomSheetModal>'s own onChange/onAnimate props below — isOpen
  // flipping false no longer closes the ref by itself; only onSheetChange(-1)
  // does, so the ref stays "open" for the sheet's full close animation
  // instead of racing ahead of what the user still sees on screen (see
  // useSheetBackHandler's JSDoc). A single call also means there is no
  // multi-listener registration order to get wrong during a same-screen
  // handoff (e.g. handleChooseRecipe) — the prior 4-call architecture needed
  // a documented load-bearing declaration order for exactly that reason.
  //
  // Because onSheetChange/onSheetAnimate are now SHARED across all 4
  // BottomSheetModal instances (unlike the old 4-hook-instance design, where
  // each had its own private isOpenRef), any one of them firing onChange(-1)
  // — a late close from a just-abandoned sheet during a handoff, or the
  // spurious blur/refocus duplicate event useSheetBackHandler's own JSDoc
  // documents — clears the ONE shared isOpenRef even while a different sheet
  // is genuinely open. Correctness in that window depends entirely on
  // useSheetBackHandler's `stateIsOpenRef` fallback (derived here from
  // `activeSheet !== null`), which was originally added for an unrelated
  // single-sheet blur/refocus bug and is now silently load-bearing for this
  // screen's multi-sheet aliasing too — do not change that fallback's logic
  // without checking this call site.
  const { onSheetChange, onSheetAnimate } = useSheetBackHandler(
    activeSheetRef,
    activeSheet !== null,
  );

  const handleNavigateUrlImport = useCallback(
    (mt: MealType | null, date?: string) => {
      if (mt === null || date === undefined) return;
      closeSheet("importRecipe");
      navigation.navigate("RecipeImport", {
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation, closeSheet],
  );

  const handlePhotoImport = useCallback(
    (uri: string, mt: MealType | null, date?: string) => {
      if (mt === null || date === undefined) return;
      closeSheet("importRecipe");
      navigation.navigate("RecipePhotoImport", {
        photoUri: uri,
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation, closeSheet],
  );

  const handleTextImport = useCallback(
    (text: string, mt: MealType | null, date?: string) => {
      if (mt === null || date === undefined) return;
      closeSheet("importRecipe");
      navigation.navigate("RecipeTextImport", {
        pastedText: text,
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation, closeSheet],
  );

  const handleNavigateCreate = useCallback(
    (mt: MealType, date: string) => {
      navigation.navigate("RecipeEntryHub", {
        returnToMealPlan: { mealType: mt, plannedDate: date },
      });
    },
    [navigation],
  );

  const handleOpenImportSheet = useCallback(
    (mt: MealType) => {
      InteractionManager.runAfterInteractions(() =>
        openSheet("importRecipe", mt),
      );
    },
    [openSheet],
  );

  const handleSuggest = useCallback(
    (mealType: MealType) => {
      if (!features.aiMealSuggestions) {
        haptics.notification(Haptics.NotificationFeedbackType.Warning);
        setShowUpgradeModal(true);
        return;
      }
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setSuggestMealType(mealType);
      setSuggestModalVisible(true);
    },
    [features.aiMealSuggestions, haptics],
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: MealSuggestion) => {
      try {
        // Create recipe from suggestion
        const recipe = await createRecipe({
          title: suggestion.title,
          description: suggestion.description,
          difficulty: suggestion.difficulty,
          prepTimeMinutes: suggestion.prepTimeMinutes,
          instructions: suggestion.instructions,
          dietTags: suggestion.dietTags,
          sourceType: "ai_suggestion",
          caloriesPerServing: suggestion.calories,
          proteinPerServing: suggestion.protein,
          carbsPerServing: suggestion.carbs,
          fatPerServing: suggestion.fat,
          ingredients: suggestion.ingredients?.map((ing) => ({
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
          })),
        });

        // Add to meal plan
        await addMealPlanItem({
          recipeId: recipe.id,
          plannedDate: selectedDateStr,
          mealType: suggestMealType,
        });

        haptics.notification(Haptics.NotificationFeedbackType.Success);
        setSuggestModalVisible(false);
        invalidateMealPlanItems(queryClient);
      } catch {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        toast.error(
          "Couldn't add the suggestion to your plan. Please try again.",
        );
      }
    },
    [
      createRecipe,
      addMealPlanItem,
      selectedDateStr,
      suggestMealType,
      haptics,
      toast,
      queryClient,
    ],
  );

  const handleConfirmItem = useCallback(
    (id: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
      confirmItem(id, {
        onError: () => toast.error("Couldn't log the meal. Please try again."),
      });
    },
    [confirmItem, haptics, toast],
  );

  const handleBrowseRecipes = useCallback(() => {
    haptics.selection();
    navigation.navigate("RecipeBrowser", {});
  }, [haptics, navigation]);

  const handleGroceryLists = useCallback(() => {
    haptics.selection();
    navigation.navigate("GroceryLists");
  }, [haptics, navigation]);

  const handlePantry = useCallback(() => {
    haptics.selection();
    navigation.navigate("Pantry");
  }, [haptics, navigation]);

  const handleCookbooks = useCallback(() => {
    haptics.selection();
    navigation.navigate("CookbookList");
  }, [haptics, navigation]);

  const handleRefresh = useCallback(async () => {
    // invalidateMealPlanItems fires-and-forgets internally (its own callers
    // never await it either); the pull-to-refresh spinner is driven by
    // useMealPlanItems' own `isRefetching`, not by this callback's await, so
    // that's still coordinated. Daily-budget and daily-summary (L6, 2026-09-23
    // audit) were previously never refreshed here at all.
    invalidateMealPlanItems(queryClient);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/daily-budget"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] }),
    ]);
    haptics.impact();
  }, [queryClient, haptics]);

  // Date strip swipe gesture
  const dateStripPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20])
        .onUpdate((e) => {
          if (!reducedMotion) {
            // Clamp visual feedback to +/-30px
            dateStripTranslateX.value = Math.max(
              -30,
              Math.min(30, e.translationX),
            );
          }
        })
        .onEnd((e) => {
          if (e.translationX < -dateStripSwipeThreshold) {
            scheduleOnRN(handleNextWeek);
          } else if (e.translationX > dateStripSwipeThreshold) {
            scheduleOnRN(handlePrevWeek);
          }
          dateStripTranslateX.value = withSpring(0, {
            damping: 20,
            stiffness: 200,
          });
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dateStripTranslateX is a stable shared value ref
    [reducedMotion, handleNextWeek, handlePrevWeek],
  );

  const dateStripAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dateStripTranslateX.value }],
  }));

  // Month/year header
  const monthYear = selectedDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Memoized so BottomSheetModal's own memo(forwardRef(...)) wrapping can
  // bail out on unrelated screen re-renders instead of re-invoking its
  // ~20-hook body every time.
  const addItemMenuSheetChildren = useMemo(
    () => (
      <AddItemMenuSheetContent
        mealType={addItemMenuMealType}
        onChooseRecipe={handleChooseRecipe}
        onSimpleEntry={handleSimpleEntry}
        onImportRecipe={handleImportRecipe}
      />
    ),
    [
      addItemMenuMealType,
      handleChooseRecipe,
      handleSimpleEntry,
      handleImportRecipe,
    ],
  );

  const importRecipeSheetChildren = useMemo(
    () => (
      <ImportRecipeSheetContent
        mealType={importRecipeMealType}
        plannedDate={selectedDateStr}
        onDismiss={handleImportRecipeDismiss}
        onNavigateUrlImport={handleNavigateUrlImport}
        onPhotoImport={handlePhotoImport}
        onTextImport={handleTextImport}
      />
    ),
    [
      importRecipeMealType,
      selectedDateStr,
      handleImportRecipeDismiss,
      handleNavigateUrlImport,
      handlePhotoImport,
      handleTextImport,
    ],
  );

  const handleQuickAddSheetChange = useCallback(
    (index: number) => {
      onSheetChange(index);
      if (index === 0) quickAddSheetContentRef.current?.focusSearchInput();
    },
    [onSheetChange],
  );

  const quickAddSheetChildren = useMemo(
    () => (
      <QuickAddSheetContent
        ref={quickAddSheetContentRef}
        mealType={quickAddMealType}
        plannedDate={selectedDateStr}
        onDismiss={handleQuickAddDismiss}
        onNavigateCreate={handleNavigateCreate}
        onOpenImportSheet={handleOpenImportSheet}
      />
    ),
    [
      quickAddMealType,
      selectedDateStr,
      handleQuickAddDismiss,
      handleNavigateCreate,
      handleOpenImportSheet,
    ],
  );

  const handleSimpleEntrySheetChange = useCallback(
    (index: number) => {
      onSheetChange(index);
      if (index === 0) simpleEntrySheetContentRef.current?.focusDishNameInput();
    },
    [onSheetChange],
  );

  const simpleEntrySheetChildren = useMemo(
    () => (
      <SimpleEntrySheetContent
        ref={simpleEntrySheetContentRef}
        mealType={simpleEntryMealType}
        plannedDate={selectedDateStr}
        onDismiss={handleSimpleEntryDismiss}
      />
    ),
    [simpleEntryMealType, selectedDateStr, handleSimpleEntryDismiss],
  );

  // Config-driven top action row, replacing 4 near-identical Pressables
  // (mirrors client/components/home/action-config.ts's data-driven pattern).
  // Built in-component (not module-level like HOME_ACTIONS) because these
  // actions close over per-render handlers/data (expiringItems' badge count).
  const topActions: TopAction[] = useMemo(
    () => [
      {
        id: "recipes",
        icon: "book-open",
        label: "Recipes",
        accessibilityLabel: "Browse Recipes",
        onPress: handleBrowseRecipes,
      },
      {
        id: "pantry",
        icon: "package",
        label: "Pantry",
        accessibilityLabel: `Pantry${expiringItems?.length ? `, ${expiringItems.length} expiring` : ""}`,
        onPress: handlePantry,
        badgeCount: expiringItems?.length,
      },
      {
        id: "grocery",
        icon: "shopping-cart",
        label: "Grocery Lists",
        accessibilityLabel: "Grocery Lists",
        onPress: handleGroceryLists,
      },
      {
        id: "cookbooks",
        icon: "book",
        label: "Cookbooks",
        accessibilityLabel: "Cookbooks",
        onPress: handleCookbooks,
      },
    ],
    [
      handleBrowseRecipes,
      handlePantry,
      handleGroceryLists,
      handleCookbooks,
      expiringItems,
    ],
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: headerHeight,
            paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <SkeletonProvider>
          <SkeletonLoadingRegion
            style={styles.skeletonContainer}
            testID="meal-plan-loading-skeleton"
          >
            <SkeletonBox width="60%" height={24} borderRadius={8} />
            <View style={{ height: Spacing.lg }} />
            <SkeletonBox width="100%" height={56} borderRadius={12} />
            <View style={{ height: Spacing.xl }} />
            {[1, 2, 3, 4].map((i) => (
              <View key={i} style={{ marginBottom: Spacing.lg }}>
                <SkeletonBox width="30%" height={16} borderRadius={4} />
                <View style={{ height: Spacing.sm }} />
                <SkeletonBox width="100%" height={48} borderRadius={8} />
              </View>
            ))}
          </SkeletonLoadingRegion>
        </SkeletonProvider>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        testID="meal-plan-home-scroll"
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.sm,
          paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            progressViewOffset={headerHeight}
          />
        }
        showsVerticalScrollIndicator={false}
        // Android TalkBack background focus trap while any of the 4 sheets
        // is open — see docs/solutions/conventions/
        // in-screen-overlay-needs-android-focus-trap-2026-06-22.md. iOS is
        // already trapped separately via accessibilityViewIsModal on each
        // sheet's own content root, so no accessibilityElementsHidden here.
        importantForAccessibility={
          isAnySheetOpen ? "no-hide-descendants" : "auto"
        }
      >
        {/* Top Action Buttons */}
        <View style={styles.topActions}>
          {topActions.map((action) => (
            <Pressable
              key={action.id}
              onPress={action.onPress}
              hitSlop={8}
              style={[
                styles.groceryButton,
                { backgroundColor: withOpacity(theme.link, 0.1) },
              ]}
              accessibilityRole="button"
              accessibilityLabel={action.accessibilityLabel}
            >
              <Feather name={action.icon} size={16} color={theme.link} />
              <ThemedText
                style={[styles.groceryButtonText, { color: theme.link }]}
              >
                {action.label}
              </ThemedText>
              {!!action.badgeCount && (
                <View
                  style={[
                    styles.expiringBadge,
                    { backgroundColor: theme.calorieAccent },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.expiringBadgeText,
                      { color: theme.buttonText },
                    ]}
                  >
                    {action.badgeCount}
                  </ThemedText>
                </View>
              )}
            </Pressable>
          ))}
        </View>

        {/* Month/Year Header with arrows */}
        <View style={styles.monthHeader}>
          <Pressable
            onPress={handlePrevWeek}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <Feather name="chevron-left" size={20} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.monthTitle}>{monthYear}</ThemedText>
          <Pressable
            onPress={handleNextWeek}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Next week"
          >
            <Feather name="chevron-right" size={20} color={theme.text} />
          </Pressable>
        </View>

        {/* Date Strip — swipe left/right to change week */}
        <GestureDetector gesture={dateStripPanGesture}>
          <Animated.View style={[styles.dateStrip, dateStripAnimatedStyle]}>
            {weekDates.map((date) => {
              const dateStr = toLocalDateString(date);
              return (
                <DateStripItem
                  key={dateStr}
                  date={date}
                  isSelected={dateStr === selectedDateStr}
                  hasItems={!!dayItems[dateStr]?.length}
                  onPress={handleDatePress}
                />
              );
            })}
          </Animated.View>
        </GestureDetector>

        {/* Day Label */}
        <ThemedText style={styles.dayLabel}>
          {getDayLabel(selectedDate)}
        </ThemedText>

        {/* Calorie Ring — suppress against the 2000 default when the budget
            fetch failed, so the user isn't shown a confident-wrong goal. */}
        {budgetErrorNoData ? (
          <EmptyState
            variant="temporary"
            icon="alert-circle"
            title="Couldn't load your calorie budget"
            description="We couldn't load your goal for this day. Pull down to refresh or tap below to try again."
            actionLabel="Try Again"
            onAction={() => {
              void refetchBudget();
            }}
          />
        ) : (
          <CalorieRing
            consumed={dailyTotals.calories}
            goal={calorieGoal}
            protein={dailyTotals.protein}
            carbs={dailyTotals.carbs}
            fat={dailyTotals.fat}
          />
        )}

        {/* A failed items fetch with no cached data (isLoadingError) renders
            HERE, where the list would go — distinct from `isRefetching`
            (pull-to-refresh keeps the loaded week) and from isRefetchError
            (a background failure with cached data, which keeps showing the
            stale week). Without this branch a failed initial fetch looked
            like a legitimately empty week (2026-09-23 audit, M18). Rendered
            in-scroll, not as an early return, so the week navigation, top
            actions and pull-to-refresh — none of which depend on this query
            — stay usable. */}
        {isLoadingError ? (
          <EmptyState
            variant="temporary"
            icon="alert-circle"
            title="Couldn't load your meal plan"
            description="Something went wrong loading this week's meals. Pull down to refresh or tap below to try again."
            actionLabel="Try Again"
            onAction={() => {
              void refetchMealPlanItems();
            }}
          />
        ) : selectedDayItems.length === 0 ? (
          <EmptyState
            variant="firstTime"
            icon="calendar"
            title="No meals planned yet"
            description="Plan your week's meals to hit your nutrition goals and auto-generate your grocery list."
            actionLabel="Browse Recipes"
            onAction={handleBrowseRecipes}
          />
        ) : (
          MEAL_TYPES.map((mealType) => {
            const sectionItems = itemsByMealType[mealType] || [];
            return (
              <MealSlotSection
                key={mealType}
                mealType={mealType}
                items={sectionItems}
                confirmedIds={confirmedIds}
                onItemPress={handleItemPress}
                onRemoveItem={handleRemoveItem}
                onAddItem={handleAddItem}
                onSuggest={handleSuggest}
                onConfirmItem={handleConfirmItem}
                onReorder={handleReorder}
                canSuggest={features.aiMealSuggestions}
                canConfirm={features.mealConfirmation}
                isExpanded={expandedSections.has(mealType)}
                onToggle={handleToggleSection}
                sectionSummary={sectionSummaries[mealType]}
              />
            );
          })
        )}

        {/* Spacer for FAB clearance */}
      </ScrollView>

      {/* Modals */}
      <MealSuggestionsModal
        visible={suggestModalVisible}
        date={selectedDateStr}
        mealType={suggestMealType}
        onClose={() => setSuggestModalVisible(false)}
        onSelectSuggestion={handleSelectSuggestion}
      />
      <UpgradeModal
        visible={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
      {/* NOTE: `accessibilityViewIsModal` was previously set on each sheet
          below too, but @gorhom/bottom-sheet's BottomSheet has no
          rest-spread, so it was silently dropped — a no-op / false
          focus-trap assurance (same dead prop ConfirmationModal.tsx's own
          fix removed). The real fix lives on each sheet's own inner content
          View, not here: AddItemMenuSheetContent, ImportRecipeSheetContent
          (shared — already had it), QuickAddSheetContent, and
          SimpleEntrySheetContent all set accessibilityViewIsModal on their
          own root View. See docs/solutions/conventions/
          a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md.
          The other focus-trap todo
          (P2-2026-09-05-confirmation-sheet-lacks-android-talkback-focus-trap.md)
          is scoped to ConfirmationModal.tsx and its useConfirmationModal()
          callers only, not this screen. */}
      <BottomSheetModal
        ref={addItemMenuSheetRef}
        snapPoints={ADD_ITEM_MENU_SNAP_POINTS}
        enableDynamicSizing={false}
        onDismiss={handleAddItemMenuDismiss}
        onChange={onSheetChange}
        onAnimate={onSheetAnimate}
        {...sheetHostProps}
      >
        {addItemMenuSheetChildren}
      </BottomSheetModal>
      <BottomSheetModal
        ref={importRecipeSheetRef}
        snapPoints={IMPORT_RECIPE_SNAP_POINTS}
        enableDynamicSizing={false}
        onDismiss={handleImportRecipeDismiss}
        onChange={onSheetChange}
        onAnimate={onSheetAnimate}
        {...sheetHostProps}
      >
        {importRecipeSheetChildren}
      </BottomSheetModal>
      <BottomSheetModal
        ref={quickAddSheetRef}
        snapPoints={QUICK_ADD_SNAP_POINTS}
        enableDynamicSizing={false}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
        onDismiss={handleQuickAddDismiss}
        onChange={handleQuickAddSheetChange}
        onAnimate={onSheetAnimate}
        {...sheetHostProps}
      >
        {quickAddSheetChildren}
      </BottomSheetModal>
      <BottomSheetModal
        ref={simpleEntrySheetRef}
        snapPoints={SIMPLE_ENTRY_SNAP_POINTS}
        enableDynamicSizing={false}
        keyboardBehavior="fillParent"
        keyboardBlurBehavior="restore"
        onDismiss={handleSimpleEntryDismiss}
        onChange={handleSimpleEntrySheetChange}
        onAnimate={onSheetAnimate}
        {...sheetHostProps}
      >
        {simpleEntrySheetChildren}
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  skeletonContainer: {
    padding: Spacing.lg,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  monthTitle: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
  },
  dateStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  dateStripItem: {
    width: 44,
    height: 64,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dateStripDayName: {
    fontSize: 11,
    fontFamily: FontFamily.medium,
  },
  dateStripDayNum: {
    fontSize: 16,
    fontFamily: FontFamily.semiBold,
  },
  dateStripDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  dayLabel: {
    fontSize: 20,
    fontFamily: FontFamily.bold,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  mealSlotSection: {
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  mealSlotHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  mealSlotLabel: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  collapsedSummary: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
  mealSlotItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.xs,
  },
  mealSlotContent: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  mealSlotName: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
  },
  mealSlotCalories: {
    fontSize: 13,
    marginTop: 2,
  },
  addItemButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: Spacing.xs,
  },
  addItemText: {
    fontSize: 14,
    fontFamily: FontFamily.medium,
  },
  topActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  expiringBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  expiringBadgeText: {
    fontSize: 10,
    fontFamily: FontFamily.bold,
    // color set dynamically with theme.buttonText (white on colored badges)
  },
  groceryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    minHeight: 44,
  },
  groceryButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  suggestChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    minHeight: 44,
  },
  suggestChipText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
