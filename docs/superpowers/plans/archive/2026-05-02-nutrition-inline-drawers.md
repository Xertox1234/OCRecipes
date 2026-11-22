# Nutrition Inline Drawers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `fasting-timer` and `log-weight` action rows in the Nutrition & Health section with always-mounted inline collapsible drawers, and remove the `ai-coach` row.

**Architecture:** Two new drawer components (`FastingDrawer`, `WeightLogDrawer`) follow the same always-mounted, `useCollapsibleHeight`-powered pattern as `QuickLogDrawer`. Pure formatting logic is extracted into co-located `*-utils.ts` files for testability. HomeScreen gets a `renderInlineAction` switch helper to dispatch to the right component per action ID.

**Tech Stack:** React Native / Expo, Reanimated 4, `react-native-svg`, TanStack Query v5, `useFastingTimer`, `useWeightLogs` / `useWeightTrend` / `useLogWeight`, Vitest

---

## File Map

| Path                                                        | Status | Responsibility                              |
| ----------------------------------------------------------- | ------ | ------------------------------------------- |
| `client/components/home/action-config.ts`                   | Modify | Add `renderInline`, remove `ai-coach`       |
| `client/components/home/__tests__/action-config.test.ts`    | Modify | Update nutrition count assertion            |
| `client/components/home/fasting-drawer-utils.ts`            | Create | Pure formatting helpers for FastingDrawer   |
| `client/components/home/__tests__/FastingDrawer.test.tsx`   | Create | Tests for fasting formatting utils          |
| `client/components/home/FastingDrawer.tsx`                  | Create | Inline fasting timer drawer                 |
| `client/components/home/weight-log-drawer-utils.ts`         | Create | Pure formatting helpers for WeightLogDrawer |
| `client/components/home/__tests__/WeightLogDrawer.test.tsx` | Create | Tests for weight formatting utils           |
| `client/components/home/WeightLogDrawer.tsx`                | Create | Inline weight log drawer                    |
| `client/screens/HomeScreen.tsx`                             | Modify | `renderInlineAction` switch helper          |

---

## Task 1: Update action-config.ts

**Files:**

- Modify: `client/components/home/action-config.ts`
- Modify: `client/components/home/__tests__/action-config.test.ts`

- [ ] **Step 1: Update the test to expect 3 nutrition actions**

  In `client/components/home/__tests__/action-config.test.ts`, change line 37:

  ```ts
  it("returns only nutrition actions", () => {
    const actions = getActionsByGroup("nutrition");
    expect(actions.length).toBe(3);
    expect(actions.every((a) => a.group === "nutrition")).toBe(true);
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run client/components/home/__tests__/action-config.test.ts
  ```

  Expected: FAIL — "Expected 3 to be 4" for the nutrition count test.

- [ ] **Step 3: Update action-config.ts**

  In `client/components/home/action-config.ts`:

  3a. Add `renderInline: true` to the `fasting-timer` entry (around line 142):

  ```ts
  {
    id: "fasting-timer",
    group: "nutrition",
    icon: "clock",
    label: "Fasting Timer",
    renderInline: true,
  },
  ```

  3b. Add `renderInline: true` to the `log-weight` entry (around line 147):

  ```ts
  {
    id: "log-weight",
    group: "nutrition",
    icon: "trending-down",
    label: "Log Weight",
    renderInline: true,
  },
  ```

  3c. Remove the entire `ai-coach` block from `HOME_ACTIONS` (lines 153–158):

  ```ts
  // DELETE this block:
  {
    id: "ai-coach",
    group: "nutrition",
    icon: "message-circle",
    label: "AI Coach",
  },
  ```

  3d. Remove the `case "ai-coach"` block from `navigateAction` (lines 49–51):

  ```ts
  // DELETE these lines:
  case "ai-coach":
    navigation.navigate("CoachTab", { screen: "ChatList" });
    break;
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  ```bash
  npx vitest run client/components/home/__tests__/action-config.test.ts
  ```

  Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add client/components/home/action-config.ts client/components/home/__tests__/action-config.test.ts
  git commit -m "feat: add renderInline to fasting-timer and log-weight; remove ai-coach"
  ```

---

## Task 2: fasting-drawer-utils.ts (TDD)

**Files:**

- Create: `client/components/home/__tests__/FastingDrawer.test.tsx`
- Create: `client/components/home/fasting-drawer-utils.ts`

- [ ] **Step 1: Write the failing tests**

  Create `client/components/home/__tests__/FastingDrawer.test.tsx`:

  ```tsx
  import {
    formatFastingSubtitle,
    formatTimeToGoal,
    formatStartedAt,
    formatLastFastDuration,
    formatCompletionRate,
    computeFastProgress,
  } from "../fasting-drawer-utils";
  import type { ApiFastingLog, FastingStats } from "@shared/types/fasting";

  describe("formatFastingSubtitle", () => {
    it("active fast: shows elapsed time and percent", () => {
      // 8h 14m elapsed of a 16h fast → 51%
      const result = formatFastingSubtitle(true, 8 * 60 + 14, 16);
      expect(result).toBe("● 8h 14m · 51%");
    });

    it("active fast: shows 100% when goal reached", () => {
      const result = formatFastingSubtitle(true, 16 * 60 + 30, 16);
      expect(result).toBe("● 16h 30m · 100%");
    });

    it("not fasting, schedule set: shows protocol scheduled", () => {
      const result = formatFastingSubtitle(false, 0, undefined, "16:8");
      expect(result).toBe("16:8 scheduled");
    });

    it("not fasting, no schedule: shows start prompt", () => {
      const result = formatFastingSubtitle(false, 0, undefined, undefined);
      expect(result).toBe("Start your first fast");
    });
  });

  describe("formatTimeToGoal", () => {
    it("returns formatted remaining time", () => {
      // 16h target, 8h 14m elapsed → 7h 46m remaining
      expect(formatTimeToGoal(8 * 60 + 14, 16)).toBe("7h 46m");
    });

    it("returns Goal reached! when elapsed >= target", () => {
      expect(formatTimeToGoal(16 * 60, 16)).toBe("Goal reached!");
      expect(formatTimeToGoal(17 * 60, 16)).toBe("Goal reached!");
    });

    it("formats sub-hour remainder correctly", () => {
      // 16h target, 15h 30m elapsed → 30m remaining
      expect(formatTimeToGoal(15 * 60 + 30, 16)).toBe("30m");
    });
  });

  describe("formatStartedAt", () => {
    it("formats AM time", () => {
      // 08:05 → "8:05 AM"
      const d = new Date("2024-01-15T08:05:00.000Z");
      // Use local interpretation: set hour directly
      const local = new Date(d);
      local.setHours(8, 5, 0, 0);
      expect(formatStartedAt(local.toISOString())).toMatch(/8:05 (AM|PM)/);
    });

    it("formats midnight as 12:00 AM", () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      expect(formatStartedAt(d.toISOString())).toBe("12:00 AM");
    });

    it("formats noon as 12:00 PM", () => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      expect(formatStartedAt(d.toISOString())).toBe("12:00 PM");
    });
  });

  describe("formatLastFastDuration", () => {
    it("returns formatted duration for the most recent completed log", () => {
      const logs: ApiFastingLog[] = [
        {
          id: 1,
          userId: "u1",
          startedAt: "2024-01-01T00:00:00Z",
          endedAt: "2024-01-01T16:00:00Z",
          targetDurationHours: 16,
          actualDurationMinutes: 940,
          completed: true,
          note: null,
        },
      ];
      expect(formatLastFastDuration(logs)).toBe("15h 40m");
    });

    it("returns — when logs are empty", () => {
      expect(formatLastFastDuration([])).toBe("—");
    });

    it("returns — when first log has null duration", () => {
      const logs: ApiFastingLog[] = [
        {
          id: 1,
          userId: "u1",
          startedAt: "2024-01-01T00:00:00Z",
          endedAt: null,
          targetDurationHours: 16,
          actualDurationMinutes: null,
          completed: null,
          note: null,
        },
      ];
      expect(formatLastFastDuration(logs)).toBe("—");
    });
  });

  describe("formatCompletionRate", () => {
    it("formats completion rate as percentage", () => {
      const stats: FastingStats = {
        totalFasts: 10,
        completedFasts: 8,
        completionRate: 0.83,
        currentStreak: 3,
        longestStreak: 5,
        averageDurationMinutes: 900,
      };
      expect(formatCompletionRate(stats)).toBe("83%");
    });

    it("returns — when stats is undefined", () => {
      expect(formatCompletionRate(undefined)).toBe("—");
    });

    it("returns — when totalFasts is 0", () => {
      const stats: FastingStats = {
        totalFasts: 0,
        completedFasts: 0,
        completionRate: 0,
        currentStreak: 0,
        longestStreak: 0,
        averageDurationMinutes: 0,
      };
      expect(formatCompletionRate(stats)).toBe("—");
    });
  });

  describe("computeFastProgress", () => {
    it("returns fractional progress", () => {
      // 8h elapsed of 16h target → 0.5
      expect(computeFastProgress(8 * 60, 16)).toBeCloseTo(0.5);
    });

    it("clamps to 1 when elapsed exceeds target", () => {
      expect(computeFastProgress(20 * 60, 16)).toBe(1);
    });

    it("returns 0 at start", () => {
      expect(computeFastProgress(0, 16)).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  ```bash
  npx vitest run client/components/home/__tests__/FastingDrawer.test.tsx
  ```

  Expected: FAIL — Cannot find module `../fasting-drawer-utils`.

- [ ] **Step 3: Implement fasting-drawer-utils.ts**

  Create `client/components/home/fasting-drawer-utils.ts`:

  ```ts
  import { formatDuration } from "@/lib/format";
  import type { ApiFastingLog, FastingStats } from "@shared/types/fasting";

  export function formatFastingSubtitle(
    isFasting: boolean,
    elapsedMinutes: number,
    targetHours: number | undefined,
    scheduleProtocol?: string,
  ): string {
    if (isFasting) {
      const progress = computeFastProgress(elapsedMinutes, targetHours ?? 16);
      const pct = Math.round(Math.min(1, progress) * 100);
      return `● ${formatDuration(elapsedMinutes)} · ${pct}%`;
    }
    if (scheduleProtocol) {
      return `${scheduleProtocol} scheduled`;
    }
    return "Start your first fast";
  }

  export function formatTimeToGoal(
    elapsedMinutes: number,
    targetHours: number,
  ): string {
    const targetMinutes = targetHours * 60;
    if (elapsedMinutes >= targetMinutes) return "Goal reached!";
    return formatDuration(targetMinutes - elapsedMinutes);
  }

  export function formatStartedAt(startedAt: string): string {
    const d = new Date(startedAt);
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  }

  export function formatLastFastDuration(logs: ApiFastingLog[]): string {
    const minutes = logs[0]?.actualDurationMinutes;
    if (minutes == null) return "—";
    return formatDuration(minutes);
  }

  export function formatCompletionRate(
    stats: FastingStats | undefined,
  ): string {
    if (!stats || stats.totalFasts === 0) return "—";
    return `${Math.round(stats.completionRate * 100)}%`;
  }

  export function computeFastProgress(
    elapsedMinutes: number,
    targetHours: number,
  ): number {
    return Math.min(1, elapsedMinutes / (targetHours * 60));
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  ```bash
  npx vitest run client/components/home/__tests__/FastingDrawer.test.tsx
  ```

  Expected: all tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add client/components/home/fasting-drawer-utils.ts client/components/home/__tests__/FastingDrawer.test.tsx
  git commit -m "feat: add fasting-drawer-utils with formatting helpers (TDD)"
  ```

---

## Task 3: FastingDrawer.tsx

**Files:**

- Create: `client/components/home/FastingDrawer.tsx`

- [ ] **Step 1: Create FastingDrawer.tsx**

  Create `client/components/home/FastingDrawer.tsx`:

  ```tsx
  import React, { useState, useCallback, useEffect } from "react";
  import { Pressable, StyleSheet, View, ActivityIndicator } from "react-native";
  import Svg, { Circle } from "react-native-svg";
  import { Feather } from "@expo/vector-icons";
  import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
  } from "react-native-reanimated";
  import { useNavigation } from "@react-navigation/native";
  import * as Haptics from "expo-haptics";

  import { ThemedText } from "@/components/ThemedText";
  import { useTheme } from "@/hooks/useTheme";
  import { useHaptics } from "@/hooks/useHaptics";
  import { useAccessibility } from "@/hooks/useAccessibility";
  import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
  import { useFastingTimer } from "@/hooks/useFastingTimer";
  import {
    Spacing,
    BorderRadius,
    FontFamily,
    withOpacity,
  } from "@/constants/theme";
  import {
    expandTimingConfig,
    collapseTimingConfig,
  } from "@/constants/animations";
  import {
    formatFastingSubtitle,
    formatTimeToGoal,
    formatStartedAt,
    formatLastFastDuration,
    formatCompletionRate,
    computeFastProgress,
  } from "./fasting-drawer-utils";
  import type { HomeScreenNavigationProp } from "@/types/navigation";
  import type { HomeAction } from "./action-config";

  // Static ring geometry — no animation in the mini ring
  const RING_SIZE = 64;
  const RING_STROKE = 6;
  const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2; // 29
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const RING_CENTER = RING_SIZE / 2; // 32

  interface FastingDrawerProps {
    action: HomeAction;
  }

  export function FastingDrawer({ action }: FastingDrawerProps) {
    const { theme } = useTheme();
    const haptics = useHaptics();
    const navigation = useNavigation<HomeScreenNavigationProp>();
    const { reducedMotion } = useAccessibility();

    const [isOpen, setIsOpen] = useState(false);
    const chevronRotation = useSharedValue(0);
    const { animatedStyle, onContentLayout } = useCollapsibleHeight(
      isOpen,
      reducedMotion,
    );

    const {
      isFasting,
      elapsedMinutes,
      currentFast,
      schedule,
      stats,
      logs,
      currentPhase,
      handleStartFast,
      handleEndFast,
      startFast,
      endFast,
      ConfirmationModal,
    } = useFastingTimer();

    const targetHours =
      currentFast?.targetDurationHours ?? schedule?.fastingHours;
    const progress = computeFastProgress(elapsedMinutes, targetHours ?? 16);

    const handleToggle = useCallback(() => {
      const next = !isOpen;
      setIsOpen(next);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      if (reducedMotion) {
        chevronRotation.value = next ? 90 : 0;
      } else {
        chevronRotation.value = withTiming(
          next ? 90 : 0,
          next ? expandTimingConfig : collapseTimingConfig,
        );
      }
    }, [isOpen, haptics, chevronRotation, reducedMotion]);

    // Keep chevron in sync when reducedMotion changes while open
    useEffect(() => {
      if (reducedMotion) {
        chevronRotation.value = isOpen ? 90 : 0;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable ref
    }, [reducedMotion]);

    const chevronStyle = useAnimatedStyle(() => ({
      transform: [{ rotate: `${chevronRotation.value}deg` }],
    }));

    const handleTapThrough = useCallback(() => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("Fasting");
    }, [haptics, navigation]);

    const subtitle = formatFastingSubtitle(
      isFasting,
      elapsedMinutes,
      targetHours,
      schedule?.protocol,
    );

    return (
      <View>
        {/* Header row */}
        <Pressable
          onPress={handleToggle}
          style={styles.header}
          accessibilityRole="button"
          accessibilityLabel={`${action.label}, ${subtitle}`}
          accessibilityState={{ expanded: isOpen }}
        >
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
          >
            <Feather
              name={action.icon as keyof typeof Feather.glyphMap}
              size={18}
              color={theme.link}
              accessible={false}
            />
          </View>
          <View style={styles.labelBlock}>
            <ThemedText type="body" style={styles.label}>
              {action.label}
            </ThemedText>
            <ThemedText
              style={[
                styles.subtitle,
                { color: isFasting ? theme.success : theme.textSecondary },
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </ThemedText>
          </View>
          <Animated.View style={chevronStyle}>
            <Feather
              name="chevron-right"
              size={16}
              color={theme.textSecondary}
              accessible={false}
            />
          </Animated.View>
        </Pressable>

        {/* Always-mounted animated drawer body */}
        <Animated.View style={[animatedStyle, styles.clipContainer]}>
          <View
            style={[
              styles.drawerBody,
              { backgroundColor: withOpacity(theme.link, 0.04) },
            ]}
            onLayout={onContentLayout}
            importantForAccessibility={isOpen ? "yes" : "no-hide-descendants"}
            aria-hidden={!isOpen}
          >
            {/* Top content row: ring + phase/ready block */}
            <View style={styles.topRow}>
              {/* Mini ring */}
              <View style={styles.ringWrapper}>
                <Svg width={RING_SIZE} height={RING_SIZE} accessible={false}>
                  <Circle
                    cx={RING_CENTER}
                    cy={RING_CENTER}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={withOpacity(theme.textSecondary, 0.2)}
                    strokeWidth={RING_STROKE}
                  />
                  {isFasting && (
                    <Circle
                      cx={RING_CENTER}
                      cy={RING_CENTER}
                      r={RING_RADIUS}
                      fill="none"
                      stroke={progress >= 1 ? theme.success : theme.link}
                      strokeWidth={RING_STROKE}
                      strokeDasharray={RING_CIRCUMFERENCE}
                      strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
                      strokeLinecap="round"
                      rotation="-90"
                      origin={`${RING_CENTER}, ${RING_CENTER}`}
                    />
                  )}
                </Svg>
                {!isFasting && (
                  <ThemedText style={[styles.ringEmoji, { opacity: 0.35 }]}>
                    🌙
                  </ThemedText>
                )}
              </View>

              {/* Phase / ready description */}
              <View style={styles.phaseBlock}>
                {isFasting && currentPhase ? (
                  <>
                    <ThemedText
                      style={[styles.phaseName, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      🔥 {currentPhase.name}
                    </ThemedText>
                    <ThemedText
                      style={[styles.phaseDesc, { color: theme.textSecondary }]}
                      numberOfLines={3}
                    >
                      {currentPhase.description}
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <ThemedText
                      style={[styles.phaseName, { color: theme.text }]}
                    >
                      Ready to fast?
                    </ThemedText>
                    <ThemedText
                      style={[styles.phaseDesc, { color: theme.textSecondary }]}
                      numberOfLines={2}
                    >
                      {schedule
                        ? `${schedule.protocol} · ${schedule.fastingHours}h fast, ${schedule.eatingHours}h eating window.`
                        : "Set up a schedule or start a 16h fast."}
                    </ThemedText>
                  </>
                )}
              </View>
            </View>

            {/* Stat chips */}
            <View style={styles.chipsRow}>
              {isFasting ? (
                <>
                  <StatChip
                    value={formatTimeToGoal(elapsedMinutes, targetHours ?? 16)}
                    label="to goal"
                    theme={theme}
                  />
                  <StatChip
                    value={String(stats?.currentStreak ?? 0)}
                    label="day streak"
                    theme={theme}
                  />
                  <StatChip
                    value={
                      currentFast ? formatStartedAt(currentFast.startedAt) : "—"
                    }
                    label="started"
                    theme={theme}
                  />
                </>
              ) : (
                <>
                  <StatChip
                    value={String(stats?.currentStreak ?? 0)}
                    label="day streak"
                    theme={theme}
                  />
                  <StatChip
                    value={formatLastFastDuration(logs)}
                    label="last fast"
                    theme={theme}
                  />
                  <StatChip
                    value={formatCompletionRate(stats)}
                    label="completion"
                    theme={theme}
                  />
                </>
              )}
            </View>

            {/* Primary action button */}
            {isFasting ? (
              <Pressable
                onPress={handleEndFast}
                disabled={endFast.isPending}
                accessibilityRole="button"
                accessibilityLabel="End Fast"
                accessibilityState={{
                  busy: endFast.isPending,
                  disabled: endFast.isPending,
                }}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: theme.error,
                    opacity: pressed || endFast.isPending ? 0.7 : 1,
                  },
                ]}
              >
                {endFast.isPending ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : (
                  <ThemedText
                    style={[
                      styles.actionButtonText,
                      { color: theme.buttonText },
                    ]}
                  >
                    ■ End Fast
                  </ThemedText>
                )}
              </Pressable>
            ) : (
              <Pressable
                onPress={handleStartFast}
                disabled={startFast.isPending}
                accessibilityRole="button"
                accessibilityLabel="Start Fast"
                accessibilityState={{
                  busy: startFast.isPending,
                  disabled: startFast.isPending,
                }}
                style={({ pressed }) => [
                  styles.actionButton,
                  {
                    backgroundColor: theme.link,
                    opacity: pressed || startFast.isPending ? 0.7 : 1,
                  },
                ]}
              >
                {startFast.isPending ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : (
                  <ThemedText
                    style={[
                      styles.actionButtonText,
                      { color: theme.buttonText },
                    ]}
                  >
                    ▶ Start Fast
                  </ThemedText>
                )}
              </Pressable>
            )}

            {/* Tap-through */}
            <Pressable
              onPress={handleTapThrough}
              accessibilityRole="link"
              accessibilityLabel="History, stats and settings"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <ThemedText style={[styles.tapThrough, { color: theme.link }]}>
                📊 History, stats & settings
              </ThemedText>
            </Pressable>
          </View>
        </Animated.View>

        <ConfirmationModal />
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // StatChip — internal helper
  // ---------------------------------------------------------------------------

  interface StatChipProps {
    value: string;
    label: string;
    theme: ReturnType<typeof import("@/hooks/useTheme").useTheme>["theme"];
  }

  function StatChip({ value, label, theme }: StatChipProps) {
    return (
      <View
        style={[
          styles.chip,
          { backgroundColor: withOpacity(theme.textSecondary, 0.08) },
        ]}
      >
        <ThemedText style={[styles.chipValue, { color: theme.text }]}>
          {value}
        </ThemedText>
        <ThemedText style={[styles.chipLabel, { color: theme.textSecondary }]}>
          {label}
        </ThemedText>
      </View>
    );
  }

  const styles = StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      minHeight: 48,
      gap: Spacing.md,
    },
    iconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: "center",
      alignItems: "center",
    },
    labelBlock: { flex: 1, gap: 2 },
    label: { lineHeight: 18 },
    subtitle: {
      fontSize: 12,
      fontFamily: FontFamily.regular,
    },
    clipContainer: { overflow: "hidden" },
    drawerBody: {
      position: "absolute",
      width: "100%",
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
      paddingTop: Spacing.sm,
      gap: Spacing.sm,
    },
    topRow: {
      flexDirection: "row",
      gap: Spacing.md,
      alignItems: "flex-start",
    },
    ringWrapper: {
      width: RING_SIZE,
      height: RING_SIZE,
      position: "relative",
      justifyContent: "center",
      alignItems: "center",
    },
    ringEmoji: {
      position: "absolute",
      fontSize: 22,
    },
    phaseBlock: { flex: 1, justifyContent: "center" },
    phaseName: {
      fontSize: 14,
      fontFamily: FontFamily.medium,
      fontWeight: "600",
    },
    phaseDesc: {
      fontSize: 12,
      fontFamily: FontFamily.regular,
      marginTop: 2,
      lineHeight: 17,
    },
    chipsRow: {
      flexDirection: "row",
      gap: Spacing.xs,
    },
    chip: {
      flex: 1,
      borderRadius: BorderRadius.sm,
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.xs,
      alignItems: "center",
      gap: 2,
    },
    chipValue: {
      fontSize: 13,
      fontFamily: FontFamily.medium,
      fontWeight: "700",
    },
    chipLabel: {
      fontSize: 9,
      fontFamily: FontFamily.regular,
      textAlign: "center",
    },
    actionButton: {
      borderRadius: BorderRadius.xs,
      paddingVertical: Spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    actionButtonText: {
      fontSize: 14,
      fontFamily: FontFamily.medium,
      fontWeight: "600",
    },
    tapThrough: {
      fontSize: 12,
      fontFamily: FontFamily.regular,
      textAlign: "center",
      paddingVertical: Spacing.xs,
    },
  });
  ```

- [ ] **Step 2: Run type check**

  ```bash
  npm run check:types 2>&1 | grep -E "FastingDrawer|fasting-drawer"
  ```

  Expected: no errors for FastingDrawer files.

- [ ] **Step 3: Run full type check to confirm no regressions**

  ```bash
  npm run check:types
  ```

  Expected: 0 errors.

- [ ] **Step 4: Commit**

  ```bash
  git add client/components/home/FastingDrawer.tsx
  git commit -m "feat: add FastingDrawer inline collapsible component"
  ```

---

## Task 4: weight-log-drawer-utils.ts (TDD)

**Files:**

- Create: `client/components/home/__tests__/WeightLogDrawer.test.tsx`
- Create: `client/components/home/weight-log-drawer-utils.ts`

- [ ] **Step 1: Write the failing tests**

  Create `client/components/home/__tests__/WeightLogDrawer.test.tsx`:

  ```tsx
  import {
    formatWeightSubtitle,
    formatWeightDelta,
    computeGoalProgress,
    formatGoalLabel,
  } from "../weight-log-drawer-utils";
  import type { ApiWeightLog } from "@shared/types/weight";

  const log = (weight: string): ApiWeightLog => ({
    id: 1,
    userId: "u1",
    weight,
    source: "manual",
    note: null,
    loggedAt: "2024-01-15T10:00:00Z",
  });

  describe("formatWeightSubtitle", () => {
    it("shows just-logged subtitle transiently", () => {
      const result = formatWeightSubtitle([], null, true, 78.2);
      expect(result).toBe("✓ Logged 78.2 kg");
    });

    it("shows weight + delta when entries and weekly rate exist", () => {
      const logs = [log("78.4")];
      const result = formatWeightSubtitle(
        logs,
        { weeklyRateOfChange: -1.2 } as any,
        false,
        undefined,
      );
      expect(result).toBe("78.4 kg · ▼ 1.2 kg/wk");
    });

    it("shows weight only when no weekly rate", () => {
      const logs = [log("78.4")];
      const result = formatWeightSubtitle(logs, null, false, undefined);
      expect(result).toBe("78.4 kg");
    });

    it("shows first-entry prompt when no logs", () => {
      const result = formatWeightSubtitle([], null, false, undefined);
      expect(result).toBe("Log your first weight");
    });
  });

  describe("formatWeightDelta", () => {
    it("formats a negative rate as downward arrow (losing weight)", () => {
      expect(formatWeightDelta(-1.2)).toBe("▼ 1.2");
    });

    it("formats a positive rate as upward arrow (gaining weight)", () => {
      expect(formatWeightDelta(0.5)).toBe("▲ 0.5");
    });

    it("returns — for null", () => {
      expect(formatWeightDelta(null)).toBe("—");
    });

    it("returns — for undefined", () => {
      expect(formatWeightDelta(undefined)).toBe("—");
    });

    it("returns — for zero (no meaningful trend)", () => {
      expect(formatWeightDelta(0)).toBe("—");
    });
  });

  describe("computeGoalProgress", () => {
    it("computes progress made toward goal (weight loss)", () => {
      // startWeight=80, currentWeight=78, goalWeight=75 → (80-78)/(80-75) = 0.4
      expect(computeGoalProgress(78, 75, 80)).toBeCloseTo(0.4);
    });

    it("returns 1 when goal is reached", () => {
      expect(computeGoalProgress(75, 75, 80)).toBeCloseTo(1);
    });

    it("clamps to 1 when past goal", () => {
      expect(computeGoalProgress(74, 75, 80)).toBe(1);
    });

    it("returns 0 when no progress made", () => {
      expect(computeGoalProgress(80, 75, 80)).toBeCloseTo(0);
    });

    it("returns 0 when any required value is null", () => {
      expect(computeGoalProgress(null, 75, 80)).toBe(0);
      expect(computeGoalProgress(78, null, 80)).toBe(0);
      expect(computeGoalProgress(78, 75, null)).toBe(0);
    });

    it("returns 0 when startWeight equals goalWeight", () => {
      expect(computeGoalProgress(75, 75, 75)).toBe(0);
    });
  });

  describe("formatGoalLabel", () => {
    it("formats remaining kg to goal", () => {
      expect(formatGoalLabel(78.4, 75.0)).toBe("3.4 kg to goal");
    });

    it("returns Goal reached! when at goal", () => {
      expect(formatGoalLabel(75.0, 75.0)).toBe("Goal reached!");
    });

    it("handles weight gain goals", () => {
      expect(formatGoalLabel(68.0, 70.0)).toBe("2.0 kg to goal");
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  ```bash
  npx vitest run client/components/home/__tests__/WeightLogDrawer.test.tsx
  ```

  Expected: FAIL — Cannot find module `../weight-log-drawer-utils`.

- [ ] **Step 3: Implement weight-log-drawer-utils.ts**

  Create `client/components/home/weight-log-drawer-utils.ts`:

  ```ts
  import type { ApiWeightLog } from "@shared/types/weight";
  import type { WeightTrend } from "@shared/types/weight";

  export function formatWeightSubtitle(
    logs: ApiWeightLog[],
    trend: Pick<WeightTrend, "weeklyRateOfChange"> | null | undefined,
    justLogged: boolean,
    justLoggedWeight: number | undefined,
  ): string {
    if (justLogged && justLoggedWeight !== undefined) {
      return `✓ Logged ${justLoggedWeight.toFixed(1)} kg`;
    }
    if (logs.length === 0) {
      return "Log your first weight";
    }
    const last = parseFloat(logs[0].weight);
    const rate = trend?.weeklyRateOfChange;
    if (rate != null && rate !== 0) {
      const delta = formatWeightDelta(rate);
      return `${last.toFixed(1)} kg · ${delta} kg/wk`;
    }
    return `${last.toFixed(1)} kg`;
  }

  export function formatWeightDelta(
    weeklyRate: number | null | undefined,
  ): string {
    if (weeklyRate == null || weeklyRate === 0) return "—";
    const abs = Math.abs(weeklyRate).toFixed(1);
    return weeklyRate < 0 ? `▼ ${abs}` : `▲ ${abs}`;
  }

  export function computeGoalProgress(
    currentWeight: number | null | undefined,
    goalWeight: number | null | undefined,
    startWeight: number | null | undefined,
  ): number {
    if (currentWeight == null || goalWeight == null || startWeight == null) {
      return 0;
    }
    const range = startWeight - goalWeight;
    if (range === 0) return 0;
    const made = startWeight - currentWeight;
    // Clamp to handle gaining-weight goals (range may be negative)
    return Math.min(1, Math.max(0, made / range));
  }

  export function formatGoalLabel(
    currentWeight: number,
    goalWeight: number,
  ): string {
    const remaining = Math.abs(currentWeight - goalWeight);
    if (remaining < 0.05) return "Goal reached!";
    return `${remaining.toFixed(1)} kg to goal`;
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass**

  ```bash
  npx vitest run client/components/home/__tests__/WeightLogDrawer.test.tsx
  ```

  Expected: all tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add client/components/home/weight-log-drawer-utils.ts client/components/home/__tests__/WeightLogDrawer.test.tsx
  git commit -m "feat: add weight-log-drawer-utils with formatting helpers (TDD)"
  ```

---

## Task 5: WeightLogDrawer.tsx

**Files:**

- Create: `client/components/home/WeightLogDrawer.tsx`

- [ ] **Step 1: Create WeightLogDrawer.tsx**

  Create `client/components/home/WeightLogDrawer.tsx`:

  ```tsx
  import React, { useState, useCallback, useEffect, useRef } from "react";
  import {
    Pressable,
    StyleSheet,
    TextInput,
    View,
    ActivityIndicator,
    AccessibilityInfo,
    Platform,
  } from "react-native";
  import { Feather } from "@expo/vector-icons";
  import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
  } from "react-native-reanimated";
  import { useNavigation } from "@react-navigation/native";
  import * as Haptics from "expo-haptics";

  import { ThemedText } from "@/components/ThemedText";
  import { useTheme } from "@/hooks/useTheme";
  import { useHaptics } from "@/hooks/useHaptics";
  import { useAccessibility } from "@/hooks/useAccessibility";
  import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
  import {
    useWeightLogs,
    useWeightTrend,
    useLogWeight,
  } from "@/hooks/useWeightLogs";
  import {
    Spacing,
    BorderRadius,
    FontFamily,
    withOpacity,
  } from "@/constants/theme";
  import {
    expandTimingConfig,
    collapseTimingConfig,
  } from "@/constants/animations";
  import {
    formatWeightSubtitle,
    formatWeightDelta,
    computeGoalProgress,
    formatGoalLabel,
  } from "./weight-log-drawer-utils";
  import type { HomeScreenNavigationProp } from "@/types/navigation";
  import type { HomeAction } from "./action-config";

  const JUST_LOGGED_DURATION_MS = 3000;

  interface WeightLogDrawerProps {
    action: HomeAction;
  }

  export function WeightLogDrawer({ action }: WeightLogDrawerProps) {
    const { theme } = useTheme();
    const haptics = useHaptics();
    const navigation = useNavigation<HomeScreenNavigationProp>();
    const { reducedMotion } = useAccessibility();

    const [isOpen, setIsOpen] = useState(false);
    const [weightInput, setWeightInput] = useState("");
    const [inputError, setInputError] = useState<string | null>(null);
    const [justLogged, setJustLogged] = useState(false);
    const [lastLoggedWeight, setLastLoggedWeight] = useState<
      number | undefined
    >(undefined);
    const justLoggedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

    const chevronRotation = useSharedValue(0);
    const { animatedStyle, onContentLayout } = useCollapsibleHeight(
      isOpen,
      reducedMotion,
    );

    const { data: logs = [] } = useWeightLogs();
    const { data: trend } = useWeightTrend();
    const logWeight = useLogWeight();

    // Cleanup timer on unmount
    useEffect(() => {
      return () => {
        if (justLoggedTimerRef.current)
          clearTimeout(justLoggedTimerRef.current);
      };
    }, []);

    const handleToggle = useCallback(() => {
      const next = !isOpen;
      setIsOpen(next);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      if (reducedMotion) {
        chevronRotation.value = next ? 90 : 0;
      } else {
        chevronRotation.value = withTiming(
          next ? 90 : 0,
          next ? expandTimingConfig : collapseTimingConfig,
        );
      }
    }, [isOpen, haptics, chevronRotation, reducedMotion]);

    // Keep chevron in sync when reducedMotion changes while open
    useEffect(() => {
      if (reducedMotion) {
        chevronRotation.value = isOpen ? 90 : 0;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value is stable ref
    }, [reducedMotion]);

    const chevronStyle = useAnimatedStyle(() => ({
      transform: [{ rotate: `${chevronRotation.value}deg` }],
    }));

    const handleLog = useCallback(() => {
      setInputError(null);
      const parsed = parseFloat(weightInput);
      if (!weightInput || isNaN(parsed) || parsed <= 0 || parsed > 999) {
        const msg = "Enter a weight between 0 and 999 kg";
        setInputError(msg);
        if (Platform.OS === "ios") {
          AccessibilityInfo.announceForAccessibility(msg);
        }
        return;
      }

      logWeight.mutate(
        { weight: parsed },
        {
          onSuccess: () => {
            haptics.notification(Haptics.NotificationFeedbackType.Success);
            setWeightInput("");
            setLastLoggedWeight(parsed);
            setJustLogged(true);
            if (justLoggedTimerRef.current) {
              clearTimeout(justLoggedTimerRef.current);
            }
            justLoggedTimerRef.current = setTimeout(() => {
              setJustLogged(false);
            }, JUST_LOGGED_DURATION_MS);
          },
          onError: (err) => {
            haptics.notification(Haptics.NotificationFeedbackType.Error);
            const msg = err.message || "Failed to log weight";
            setInputError(msg);
            if (Platform.OS === "ios") {
              AccessibilityInfo.announceForAccessibility(msg);
            }
          },
        },
      );
    }, [weightInput, logWeight, haptics]);

    const handleTapThrough = useCallback(() => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("WeightTracking");
    }, [haptics, navigation]);

    const subtitle = formatWeightSubtitle(
      logs,
      trend,
      justLogged,
      lastLoggedWeight,
    );
    const lastWeight = logs[0] ? parseFloat(logs[0].weight) : null;
    const goalWeight = trend?.goalWeight ?? null;
    const startWeight =
      logs.length > 0 ? parseFloat(logs[logs.length - 1].weight) : null;
    const goalProgress = computeGoalProgress(
      lastWeight,
      goalWeight,
      startWeight,
    );
    const showGoalBar = goalWeight !== null && lastWeight !== null;

    return (
      <View>
        {/* Header row */}
        <Pressable
          onPress={handleToggle}
          style={styles.header}
          accessibilityRole="button"
          accessibilityLabel={`${action.label}, ${subtitle}`}
          accessibilityState={{ expanded: isOpen }}
        >
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
          >
            <Feather
              name={action.icon as keyof typeof Feather.glyphMap}
              size={18}
              color={theme.link}
              accessible={false}
            />
          </View>
          <View style={styles.labelBlock}>
            <ThemedText type="body" style={styles.label}>
              {action.label}
            </ThemedText>
            <ThemedText
              style={[
                styles.subtitle,
                {
                  color: justLogged ? theme.success : theme.textSecondary,
                },
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </ThemedText>
          </View>
          <Animated.View style={chevronStyle}>
            <Feather
              name="chevron-right"
              size={16}
              color={theme.textSecondary}
              accessible={false}
            />
          </Animated.View>
        </Pressable>

        {/* Always-mounted animated drawer body */}
        <Animated.View style={[animatedStyle, styles.clipContainer]}>
          <View
            style={[
              styles.drawerBody,
              { backgroundColor: withOpacity(theme.link, 0.04) },
            ]}
            onLayout={onContentLayout}
            importantForAccessibility={isOpen ? "yes" : "no-hide-descendants"}
            aria-hidden={!isOpen}
          >
            {/* Stat chips */}
            <View style={styles.chipsRow}>
              <StatChip
                value={lastWeight !== null ? `${lastWeight.toFixed(1)}` : "—"}
                label="last (kg)"
                theme={theme}
              />
              <StatChip
                value={
                  trend?.weeklyRateOfChange != null &&
                  trend.weeklyRateOfChange !== 0
                    ? formatWeightDelta(trend.weeklyRateOfChange)
                    : "—"
                }
                label="this week"
                theme={theme}
                valueColor={
                  trend?.weeklyRateOfChange != null
                    ? trend.weeklyRateOfChange < 0
                      ? theme.success
                      : theme.error
                    : undefined
                }
              />
              <StatChip
                value={goalWeight !== null ? `${goalWeight.toFixed(1)}` : "—"}
                label="goal (kg)"
                theme={theme}
              />
            </View>

            {/* Goal progress bar */}
            {showGoalBar && (
              <View>
                <View
                  style={[
                    styles.goalBarTrack,
                    { backgroundColor: withOpacity(theme.textSecondary, 0.15) },
                  ]}
                >
                  <View
                    style={[
                      styles.goalBarFill,
                      {
                        backgroundColor: theme.link,
                        width: `${Math.round(goalProgress * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <ThemedText
                  style={[styles.goalLabel, { color: theme.textSecondary }]}
                >
                  {formatGoalLabel(lastWeight!, goalWeight!)}
                </ThemedText>
              </View>
            )}

            {/* Weight input */}
            <View style={styles.inputRow}>
              <TextInput
                style={[
                  styles.weightInput,
                  {
                    color: theme.text,
                    backgroundColor: theme.backgroundSecondary,
                    borderColor: inputError ? theme.error : theme.border,
                  },
                ]}
                placeholder={
                  lastWeight !== null ? lastWeight.toFixed(1) : "0.0"
                }
                placeholderTextColor={theme.textSecondary}
                value={weightInput}
                onChangeText={(v) => {
                  setWeightInput(v);
                  if (inputError) setInputError(null);
                }}
                keyboardType="decimal-pad"
                returnKeyType="done"
                onSubmitEditing={handleLog}
                aria-invalid={inputError != null}
                accessibilityLabel="Weight in kg"
              />
              <View
                style={[
                  styles.unitBadge,
                  { backgroundColor: withOpacity(theme.textSecondary, 0.1) },
                ]}
              >
                <ThemedText
                  style={[styles.unitText, { color: theme.textSecondary }]}
                >
                  kg
                </ThemedText>
              </View>
            </View>

            {inputError && (
              <ThemedText style={[styles.errorText, { color: theme.error }]}>
                {inputError}
              </ThemedText>
            )}

            {/* Log button */}
            <Pressable
              onPress={handleLog}
              disabled={logWeight.isPending}
              accessibilityRole="button"
              accessibilityLabel="Log Weight"
              accessibilityState={{
                busy: logWeight.isPending,
                disabled: logWeight.isPending,
              }}
              style={({ pressed }) => [
                styles.logButton,
                {
                  backgroundColor: theme.link,
                  opacity: pressed || logWeight.isPending ? 0.7 : 1,
                },
              ]}
            >
              {logWeight.isPending ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <ThemedText
                  style={[styles.logButtonText, { color: theme.buttonText }]}
                >
                  Log Weight
                </ThemedText>
              )}
            </Pressable>

            {/* Tap-through */}
            <Pressable
              onPress={handleTapThrough}
              accessibilityRole="link"
              accessibilityLabel="Full chart and history"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <ThemedText style={[styles.tapThrough, { color: theme.link }]}>
                Full chart & history →
              </ThemedText>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // StatChip
  // ---------------------------------------------------------------------------

  interface StatChipProps {
    value: string;
    label: string;
    theme: ReturnType<typeof import("@/hooks/useTheme").useTheme>["theme"];
    valueColor?: string;
  }

  function StatChip({ value, label, theme, valueColor }: StatChipProps) {
    return (
      <View
        style={[
          styles.chip,
          { backgroundColor: withOpacity(theme.textSecondary, 0.08) },
        ]}
      >
        <ThemedText
          style={[styles.chipValue, { color: valueColor ?? theme.text }]}
        >
          {value}
        </ThemedText>
        <ThemedText style={[styles.chipLabel, { color: theme.textSecondary }]}>
          {label}
        </ThemedText>
      </View>
    );
  }

  const styles = StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      minHeight: 48,
      gap: Spacing.md,
    },
    iconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: "center",
      alignItems: "center",
    },
    labelBlock: { flex: 1, gap: 2 },
    label: { lineHeight: 18 },
    subtitle: {
      fontSize: 12,
      fontFamily: FontFamily.regular,
    },
    clipContainer: { overflow: "hidden" },
    drawerBody: {
      position: "absolute",
      width: "100%",
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
      paddingTop: Spacing.sm,
      gap: Spacing.sm,
    },
    chipsRow: {
      flexDirection: "row",
      gap: Spacing.xs,
    },
    chip: {
      flex: 1,
      borderRadius: BorderRadius.sm,
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.xs,
      alignItems: "center",
      gap: 2,
    },
    chipValue: {
      fontSize: 13,
      fontFamily: FontFamily.medium,
      fontWeight: "700",
    },
    chipLabel: {
      fontSize: 9,
      fontFamily: FontFamily.regular,
      textAlign: "center",
    },
    goalBarTrack: {
      height: 5,
      borderRadius: 3,
      overflow: "hidden",
    },
    goalBarFill: {
      height: "100%",
      borderRadius: 3,
    },
    goalLabel: {
      fontSize: 11,
      fontFamily: FontFamily.regular,
      marginTop: 3,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
    },
    weightInput: {
      flex: 1,
      fontSize: 22,
      fontFamily: FontFamily.medium,
      fontWeight: "700",
      borderWidth: 1.5,
      borderRadius: BorderRadius.xs,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
      minHeight: 48,
    },
    unitBadge: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.xs,
      justifyContent: "center",
      alignItems: "center",
    },
    unitText: {
      fontSize: 14,
      fontFamily: FontFamily.medium,
      fontWeight: "600",
    },
    errorText: {
      fontSize: 12,
      fontFamily: FontFamily.regular,
    },
    logButton: {
      borderRadius: BorderRadius.xs,
      paddingVertical: Spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    logButtonText: {
      fontSize: 14,
      fontFamily: FontFamily.medium,
      fontWeight: "600",
    },
    tapThrough: {
      fontSize: 12,
      fontFamily: FontFamily.regular,
      textAlign: "center",
      paddingVertical: Spacing.xs,
    },
  });
  ```

- [ ] **Step 2: Run type check**

  ```bash
  npm run check:types 2>&1 | grep -E "WeightLogDrawer|weight-log-drawer"
  ```

  Expected: no errors for WeightLogDrawer files.

- [ ] **Step 3: Run full type check**

  ```bash
  npm run check:types
  ```

  Expected: 0 errors.

- [ ] **Step 4: Commit**

  ```bash
  git add client/components/home/WeightLogDrawer.tsx
  git commit -m "feat: add WeightLogDrawer inline collapsible component"
  ```

---

## Task 6: HomeScreen.tsx — renderInlineAction helper

**Files:**

- Modify: `client/screens/HomeScreen.tsx`

- [ ] **Step 1: Add imports and renderInlineAction helper**

  In `client/screens/HomeScreen.tsx`:

  1a. Add imports after the existing `QuickLogDrawer` import (around line 18):

  ```tsx
  import { FastingDrawer } from "@/components/home/FastingDrawer";
  import { WeightLogDrawer } from "@/components/home/WeightLogDrawer";
  import type { HomeAction } from "@/components/home/action-config";
  ```

  1b. Add the `renderInlineAction` helper function inside the `HomeScreen` component body **before** the return statement, after existing hooks:

  ```tsx
  function renderInlineAction(action: HomeAction) {
    switch (action.id) {
      case "quick-log":
        return <QuickLogDrawer key={action.id} action={action} />;
      case "fasting-timer":
        return <FastingDrawer key={action.id} action={action} />;
      case "log-weight":
        return <WeightLogDrawer key={action.id} action={action} />;
      default:
        return null;
    }
  }
  ```

  1c. Replace the existing inline dispatch (around line 190) from:

  ```tsx
  action.renderInline ? (
    <QuickLogDrawer key={action.id} action={action} />
  ) : (
  ```

  To:

  ```tsx
  action.renderInline ? (
    renderInlineAction(action)
  ) : (
  ```

- [ ] **Step 2: Run type check**

  ```bash
  npm run check:types
  ```

  Expected: 0 errors.

- [ ] **Step 3: Run all tests**

  ```bash
  npm run test:run
  ```

  Expected: all tests pass. Note the count: it should be ≥ original + the new utils tests.

- [ ] **Step 4: Commit**

  ```bash
  git add client/screens/HomeScreen.tsx
  git commit -m "feat: dispatch inline actions via renderInlineAction helper in HomeScreen"
  ```

---

## Verification

After all tasks are committed:

- [ ] Run `npm run check:types` — 0 errors
- [ ] Run `npm run test:run` — all tests pass (including the 2 new utils test files)
- [ ] Run `npm run lint` — 0 errors
- [ ] Build and launch in iOS Simulator, navigate to Home → expand Nutrition & Health section
  - Fasting Timer row shows current fast status or idle subtitle
  - Log Weight row shows last weight or "Log your first weight"
  - AI Coach row is gone
  - Tap fasting timer chevron → drawer expands, mini ring visible, stat chips shown, Start/End button works
  - Tap log weight chevron → drawer expands, stat chips + input + Log button
  - Enter a weight → tap Log → input clears, subtitle shows "✓ Logged X.X kg" for ~3 seconds
  - Tap "Full chart & history →" → navigates to WeightTracking screen
  - Tap "History, stats & settings" → navigates to Fasting screen
