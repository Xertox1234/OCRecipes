import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  AccessibilityInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useTTS } from "@/hooks/useTTS";
import { useCookRecipe } from "@/hooks/useCookRecipe";
import { useCookTimers, type FinishedCookTimer } from "@/hooks/useCookTimers";
import {
  formatCountdown,
  stepSpeech,
  type CookCard,
} from "@/lib/cook-mode-utils";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavProp = NativeStackNavigationProp<RootStackParamList, "CookMode">;

/** Speech ids for timer notices, clear of the card indexes used for steps. */
const TIMER_SPEECH_ID = -1000;

/**
 * Cook mode (Coach roadmap V1): one recipe step per card, read aloud, with
 * timers read from the step's own wording. The screen stays awake while it
 * is open. Nothing is saved or logged here.
 */
export default function CookModeScreen() {
  const navigation = useNavigation<NavProp>();
  const { recipeId, recipeType } =
    useRoute<RouteProp<RootStackParamList, "CookMode">>().params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { screenReaderEnabled } = useAccessibility();
  const { speak, stop } = useTTS();
  useKeepAwake();

  const { title, cards, isLoading, isError, refetch } = useCookRecipe(
    recipeId,
    recipeType ?? "community",
  );

  const [index, setIndex] = useState(0);
  const [readAloud, setReadAloud] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const card: CookCard | undefined = cards[index];
  const stepCount = cards.filter((c) => c.kind === "step").length;
  const spoken = card ? stepSpeech(card, stepCount) : null;

  // The speech functions change identity when their own inputs do. They are
  // read through a ref, so that is never a reason to read a card again: a
  // second `speak` with the same id would toggle the reading off.
  const speechRef = useRef({ speak, stop });
  useEffect(() => {
    speechRef.current = { speak, stop };
  });

  // Whatever was being read when cook mode opened (a Coach reply) stops.
  useEffect(() => {
    speechRef.current.stop();
  }, []);

  // Read the card when it changes, or when read-aloud is turned on. With a
  // screen reader on, the reading is the screen reader's: two voices at once
  // cannot be followed.
  useEffect(() => {
    if (!spoken) return;
    if (screenReaderEnabled) {
      AccessibilityInfo.announceForAccessibility(spoken);
      return;
    }
    if (readAloud) speechRef.current.speak(index, spoken);
  }, [index, spoken, readAloud, screenReaderEnabled]);

  // A notice counter, so two timers ending together get distinct speech ids.
  const noticeCountRef = useRef(0);
  const onTimerDone = useCallback(
    (timer: FinishedCookTimer) => {
      const text = `Timer done: ${timer.label} (step ${timer.stepNumber})`;
      setNotice(text);
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(text);
      // Said even with read-aloud off: a timer is an alarm. The screen
      // reader's own announcement covers it when one is on.
      if (!screenReaderEnabled) {
        noticeCountRef.current += 1;
        speechRef.current.speak(
          TIMER_SPEECH_ID - noticeCountRef.current,
          `Timer done. ${timer.label}, step ${timer.stepNumber}.`,
        );
      }
    },
    [haptics, screenReaderEnabled],
  );
  const { timers, start, cancel } = useCookTimers(onTimerDone);

  const toggleReadAloud = () => {
    if (readAloud) speechRef.current.stop();
    setReadAloud(!readAloud);
  };

  const close = () => navigation.goBack();

  const closeButton = (
    <Pressable
      onPress={close}
      style={styles.iconButton}
      accessibilityRole="button"
      accessibilityLabel="Close cook mode"
      hitSlop={8}
    >
      <Feather name="x" size={24} color={theme.text} />
    </Pressable>
  );

  const frame = {
    backgroundColor: theme.backgroundRoot,
    paddingTop: insets.top + Spacing.sm,
    paddingBottom: insets.bottom + Spacing.md,
  };

  if (!card) {
    return (
      <View style={[styles.container, frame]} accessibilityViewIsModal>
        <View style={styles.header}>{closeButton}</View>
        <View style={styles.centered}>
          {isLoading ? (
            <View accessible accessibilityLabel="Loading recipe">
              <ActivityIndicator color={theme.link} />
            </View>
          ) : isError ? (
            <>
              <Text style={[styles.message, { color: theme.text }]}>
                {"Couldn't load this recipe."}
              </Text>
              <Pressable
                onPress={refetch}
                style={[
                  styles.primaryButton,
                  { backgroundColor: theme.accentSolid },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Try again"
              >
                <Text style={[styles.primaryText, { color: theme.buttonText }]}>
                  Try Again
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={[styles.message, { color: theme.text }]}>
              This recipe has no steps to cook from.
            </Text>
          )}
        </View>
      </View>
    );
  }

  const isLast = index === cards.length - 1;
  const otherTimers = timers.filter(
    (t) => card.kind !== "step" || t.stepNumber !== card.number,
  );

  return (
    <View style={[styles.container, frame]} accessibilityViewIsModal>
      <View style={styles.header}>
        {closeButton}
        <Text
          style={[styles.title, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Pressable
          onPress={toggleReadAloud}
          style={styles.iconButton}
          accessibilityRole="switch"
          accessibilityLabel="Read steps aloud"
          accessibilityState={{ checked: readAloud }}
          hitSlop={8}
        >
          <Feather
            name={readAloud ? "volume-2" : "volume-x"}
            size={24}
            color={readAloud ? theme.link : theme.textSecondary}
          />
        </Pressable>
      </View>

      {notice ? (
        <View
          style={[
            styles.notice,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <Feather name="bell" size={18} color={theme.link} />
          <Text style={[styles.noticeText, { color: theme.text }]}>
            {notice}
          </Text>
          <Pressable
            onPress={() => setNotice(null)}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Dismiss timer notice"
            hitSlop={8}
          >
            <Feather name="x" size={18} color={theme.text} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <Text
          style={[styles.progress, { color: theme.link }]}
          accessibilityRole="header"
        >
          {card.kind === "ready"
            ? "Get ready"
            : `Step ${card.number} of ${stepCount}`}
        </Text>

        {card.kind === "ready" ? (
          card.ingredients.map((line, i) => (
            <Text key={i} style={[styles.ingredient, { color: theme.text }]}>
              {line}
            </Text>
          ))
        ) : (
          <>
            <Text style={[styles.stepText, { color: theme.text }]}>
              {card.text}
            </Text>
            {card.detail ? (
              <Text style={[styles.detail, { color: theme.textSecondary }]}>
                {card.detail}
              </Text>
            ) : null}
            {card.timers.map((timer, i) => {
              const id = `${card.number}:${i}`;
              const running = timers.find((t) => t.id === id);
              return running ? (
                <View
                  key={id}
                  style={[
                    styles.timerRow,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                >
                  <Feather name="clock" size={20} color={theme.link} />
                  <Text
                    style={[styles.countdown, { color: theme.text }]}
                    accessibilityLabel={`${timer.label} timer, ${formatCountdown(running.remaining)} left`}
                  >
                    {formatCountdown(running.remaining)}
                  </Text>
                  <Pressable
                    onPress={() => cancel(id)}
                    style={styles.timerCancel}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel ${timer.label} timer`}
                  >
                    <Text style={[styles.timerAction, { color: theme.link }]}>
                      Cancel
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  key={id}
                  onPress={() => start(id, timer, card.number)}
                  style={[styles.timerRow, { borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Start ${timer.label} timer`}
                >
                  <Feather name="clock" size={20} color={theme.link} />
                  <Text style={[styles.timerAction, { color: theme.link }]}>
                    Start {timer.label} timer
                  </Text>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      {otherTimers.length > 0 ? (
        <View style={styles.otherTimers}>
          {otherTimers.map((t) => (
            <Text
              key={t.id}
              style={[
                styles.otherTimer,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundSecondary,
                },
              ]}
              accessibilityLabel={`Step ${t.stepNumber} timer, ${formatCountdown(t.remaining)} left`}
            >
              {`Step ${t.stepNumber} · ${formatCountdown(t.remaining)}`}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.footer}>
        {index > 0 ? (
          <Pressable
            onPress={() => setIndex(index - 1)}
            style={[styles.secondaryButton, { borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Previous step"
          >
            <Text style={[styles.secondaryText, { color: theme.text }]}>
              Back
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={isLast ? close : () => setIndex(index + 1)}
          style={[
            styles.primaryButton,
            styles.footerPrimary,
            { backgroundColor: theme.accentSolid },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isLast ? "Finish cooking" : "Next step"}
        >
          <Text style={[styles.primaryText, { color: theme.buttonText }]}>
            {isLast ? "Done" : "Next"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  title: {
    ...Typography.small,
    flex: 1,
    textAlign: "center",
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  message: {
    ...Typography.body,
    textAlign: "center",
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingLeft: Spacing.md,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  noticeText: {
    ...Typography.body,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    gap: Spacing.md,
  },
  progress: {
    ...Typography.h4,
  },
  stepText: {
    ...Typography.h3,
    lineHeight: 34,
  },
  detail: {
    ...Typography.body,
  },
  ingredient: {
    ...Typography.h4,
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  countdown: {
    ...Typography.h3,
    flex: 1,
    fontVariant: ["tabular-nums"],
  },
  timerCancel: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  timerAction: {
    ...Typography.body,
    fontWeight: "600",
  },
  otherTimers: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  otherTimer: {
    ...Typography.small,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
    fontVariant: ["tabular-nums"],
  },
  footer: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  footerPrimary: {
    flex: 1,
  },
  primaryText: {
    ...Typography.body,
    fontWeight: "600",
  },
  secondaryButton: {
    minHeight: 52,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    ...Typography.body,
    fontWeight: "600",
  },
});
