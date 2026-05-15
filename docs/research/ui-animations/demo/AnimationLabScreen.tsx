/**
 * AnimationLabScreen — a runnable showcase of the patterns in this research
 * folder. Each section is a self-contained example with a heading, a
 * one-line description, the live demo, and a "technique" hint below.
 *
 * Designed to be the *most-edited* file in this folder — tweak constants,
 * swap easing curves, try different spring configs, see what changes. This
 * is the playground.
 *
 * Drop it in the root navigator via the instructions in ./README.md.
 *
 * Every example respects useAccessibility().reducedMotion and uses the
 * project's existing animation configs from @/constants/animations. The
 * intent is to teach by demonstrating *house style*, not by inventing
 * one-off conventions.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  FadeOut,
  Layout,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";

import {
  BorderRadius,
  Colors,
  FontFamily,
  Shadows,
  Spacing,
  Typography,
  withOpacity,
} from "@/constants/theme";
import {
  pressSpringConfig,
  speedDialStaggerDelay,
  swipeActionThreshold,
} from "@/constants/animations";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useHaptics } from "@/hooks/useHaptics";
import { useSuccessPop } from "@/hooks/useSuccessAnimation";

// ────────────────────────────────────────────────────────────────────────────
// Top-level screen
// ────────────────────────────────────────────────────────────────────────────

const palette = Colors.light;

export default function AnimationLabScreen() {
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
    },
  });

  return (
    <View style={styles.root}>
      <ShrinkingHeader scrollY={scrollY} />
      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <Intro />
        <Section
          title="1. Press feedback"
          description="Every tappable element should respond on press-in, not just on press."
          technique="useSharedValue + withSpring on scale, tied to onPressIn/onPressOut. pressSpringConfig from @/constants/animations."
        >
          <PressFeedbackDemo />
        </Section>
        <Section
          title="2. Success pop"
          description="A heart that scales past 1.0 and springs back. Already exported from the project as useSuccessPop."
          technique="useSuccessPop(peakScale) → animatedStyle. Haptic always fires (even with reducedMotion). Reused project hook."
        >
          <SuccessPopDemo />
        </Section>
        <Section
          title="3. Number ticker"
          description="Daily calorie totals shouldn't snap; they should count up so the action feels rewarded."
          technique="useSharedValue + withTiming + useAnimatedProps on an AnimatedTextInput (workaround for Text not accepting animated props)."
        >
          <NumberTickerDemo />
        </Section>
        <Section
          title="4. Shimmer skeleton"
          description="Placeholder that says 'content is coming.' Use for 150–2000 ms waits."
          technique="withRepeat(withTiming(...)) on a translateX. Disabled under reducedMotion — falls back to static placeholder."
        >
          <SkeletonDemo />
        </Section>
        <Section
          title="5. Staggered list entrance"
          description="A list of items appearing in sequence guides the eye top-down. Cap at ~6 items."
          technique="Animated.View entering={FadeInDown.delay(i * 50).springify()}. Layout animations under reducedMotion are auto-skipped by Reanimated."
        >
          <StaggeredListDemo />
        </Section>
        <Section
          title="6. Swipe-to-dismiss"
          description="Drag a card off-screen to dismiss. Springs back if released before threshold."
          technique="Gesture.Pan() driving translateX shared value. Threshold from @/constants/animations.swipeActionThreshold. runOnJS to call back into React state on commit."
        >
          <SwipeToDismissDemo />
        </Section>
        <Section
          title="7. Spring vs timing"
          description="Same target, different driver. Springs feel alive; timing curves feel calculated."
          technique="withSpring vs withTiming — same start, same end, very different middle. Springs interrupt cleanly; timing curves don't."
        >
          <SpringVsTimingDemo />
        </Section>
        <Section
          title="8. Layout animation on add/remove"
          description="Items animate to new positions when the list changes — for free."
          technique="layout={Layout.springify()} on the row. Combined with entering={FadeIn} and exiting={FadeOut}."
        >
          <LayoutAnimationDemo />
        </Section>
        <Section
          title="9. Reduce Motion preview"
          description="Toggle Settings → Accessibility → Motion → Reduce Motion in iOS and reload — every demo above should still work, just without the motion."
          technique="useAccessibility().reducedMotion. Reanimated's useReducedMotion() under the hood. Layout animations auto-skip; manual animations need the gate."
        >
          <ReducedMotionStatus />
        </Section>
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Edit this file at{"\n"}
            docs/research/ui-animations/demo/AnimationLabScreen.tsx
          </Text>
        </View>
      </Animated.ScrollView>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Header & layout shells
// ────────────────────────────────────────────────────────────────────────────

const HEADER_MAX = 140;
const HEADER_MIN = 64;

function ShrinkingHeader({ scrollY }: { scrollY: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => {
    const height = interpolate(
      scrollY.value,
      [0, HEADER_MAX - HEADER_MIN],
      [HEADER_MAX, HEADER_MIN],
      Extrapolation.CLAMP,
    );
    return { height };
  });

  const titleStyle = useAnimatedStyle(() => {
    const fontSize = interpolate(
      scrollY.value,
      [0, HEADER_MAX - HEADER_MIN],
      [Typography.h2.fontSize, Typography.h4.fontSize],
      Extrapolation.CLAMP,
    );
    return { fontSize };
  });

  return (
    <Animated.View style={[styles.header, animatedStyle]}>
      <Animated.Text style={[styles.headerTitle, titleStyle]}>
        Animation Lab
      </Animated.Text>
    </Animated.View>
  );
}

interface SectionProps {
  title: string;
  description: string;
  technique: string;
  children: React.ReactNode;
}

function Section({ title, description, technique, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionDescription}>{description}</Text>
      <View style={styles.demoBox}>{children}</View>
      <Text style={styles.sectionTechnique}>{technique}</Text>
    </View>
  );
}

function Intro() {
  return (
    <View style={styles.intro}>
      <Text style={styles.introText}>
        Scroll through the demos below. Each section shows a single technique in
        isolation. All examples respect the OS Reduce Motion preference.
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Press feedback
// ────────────────────────────────────────────────────────────────────────────

function PressFeedbackDemo() {
  const scale = useSharedValue(1);
  const { reducedMotion } = useAccessibility();
  const haptics = useHaptics();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (reducedMotion) return;
    scale.value = withSpring(0.96, pressSpringConfig);
  };

  const handlePressOut = () => {
    if (reducedMotion) return;
    scale.value = withSpring(1, pressSpringConfig);
  };

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={() => haptics.impact(Haptics.ImpactFeedbackStyle.Light)}
    >
      <Animated.View style={[styles.primaryButton, animatedStyle]}>
        <Text style={styles.primaryButtonText}>Press me</Text>
      </Animated.View>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Success pop (heart)
// ────────────────────────────────────────────────────────────────────────────

function SuccessPopDemo() {
  const [favorited, setFavorited] = useState(false);
  const { trigger, animatedStyle } = useSuccessPop(1.4);

  const handlePress = () => {
    setFavorited((prev) => !prev);
    trigger(); // fires haptic + scale pop (haptic stays on under reducedMotion)
  };

  return (
    <Pressable onPress={handlePress} style={styles.heartPressable}>
      <Animated.Text style={[styles.heart, animatedStyle]}>
        {favorited ? "♥" : "♡"}
      </Animated.Text>
      <Text style={styles.heartLabel}>
        {favorited ? "Favorited" : "Tap to favorite"}
      </Text>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Number ticker
// ────────────────────────────────────────────────────────────────────────────

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function NumberTickerDemo() {
  const [target, setTarget] = useState(0);
  const animatedValue = useSharedValue(0);
  const { reducedMotion } = useAccessibility();

  useEffect(() => {
    if (reducedMotion) {
      animatedValue.value = target;
      return;
    }
    animatedValue.value = withTiming(target, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });
  }, [target, animatedValue, reducedMotion]);

  const animatedProps = useAnimatedProps(() => {
    // 'worklet' implicit — useAnimatedProps wraps in a worklet.
    // The `text` prop isn't part of TextInput's public type, but Reanimated
    // accepts it as an animated prop. `as any` is the documented idiom here.
    const text = `${Math.round(animatedValue.value)} kcal`;
    return {
      text,
      defaultValue: text,
    } as any;
  });

  return (
    <View style={styles.tickerWrap}>
      <AnimatedTextInput
        editable={false}
        style={styles.tickerText}
        animatedProps={animatedProps}
        underlineColorAndroid="transparent"
      />
      <View style={styles.row}>
        <SmallButton label="+250" onPress={() => setTarget((v) => v + 250)} />
        <SmallButton label="+50" onPress={() => setTarget((v) => v + 50)} />
        <SmallButton
          label="Reset"
          onPress={() => setTarget(0)}
          tone="secondary"
        />
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Shimmer skeleton
// ────────────────────────────────────────────────────────────────────────────

function SkeletonDemo() {
  const [loading, setLoading] = useState(true);

  return (
    <View style={styles.skeletonWrap}>
      {loading ? (
        <>
          <SkeletonBlock width={220} height={20} />
          <View style={{ height: Spacing.sm }} />
          <SkeletonBlock width={160} height={14} />
          <View style={{ height: Spacing.xs }} />
          <SkeletonBlock width={180} height={14} />
        </>
      ) : (
        <View>
          <Text style={styles.loadedTitle}>Greek yoghurt with honey</Text>
          <Text style={styles.loadedMeta}>240 kcal • 18g protein</Text>
          <Text style={styles.loadedMeta}>12g carbs • 8g fat</Text>
        </View>
      )}
      <View style={{ height: Spacing.md }} />
      <SmallButton
        label={loading ? "Reveal content" : "Reset"}
        onPress={() => setLoading((v) => !v)}
      />
    </View>
  );
}

interface SkeletonBlockProps {
  width: number;
  height: number;
}

function SkeletonBlock({ width, height }: SkeletonBlockProps) {
  const { reducedMotion } = useAccessibility();
  const translateX = useSharedValue(-width);

  useEffect(() => {
    if (reducedMotion) return;
    translateX.value = withRepeat(
      withTiming(width, {
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(translateX);
    };
  }, [reducedMotion, translateX, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      style={[styles.skeletonBase, { width, height, borderRadius: height / 2 }]}
    >
      {!reducedMotion && (
        <Animated.View
          style={[styles.skeletonShimmer, { width }, animatedStyle]}
        />
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Staggered list entrance
// ────────────────────────────────────────────────────────────────────────────

const STAGGER_ITEMS = [
  "🥚  Two eggs",
  "🫐  Blueberries",
  "🥣  Oatmeal",
  "🥄  Almond butter",
  "🍵  Green tea",
];

function StaggeredListDemo() {
  const [version, setVersion] = useState(0);

  return (
    <View>
      {STAGGER_ITEMS.map((label, index) => (
        <Animated.View
          // Key includes version so React re-mounts on "Replay" and the
          // entering animation fires again. In production code you wouldn't
          // need this — entering only runs once per mount anyway.
          key={`${version}-${label}`}
          entering={FadeInDown.delay(index * speedDialStaggerDelay)
            .duration(300)
            .springify()
            .damping(15)
            .stiffness(150)}
          style={styles.staggerItem}
        >
          <Text style={styles.staggerItemText}>{label}</Text>
        </Animated.View>
      ))}
      <View style={{ height: Spacing.sm }} />
      <SmallButton
        label="Replay stagger"
        onPress={() => setVersion((v) => v + 1)}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 6. Swipe-to-dismiss
// ────────────────────────────────────────────────────────────────────────────

function SwipeToDismissDemo() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return (
      <View>
        <Text style={styles.dismissedText}>Dismissed.</Text>
        <View style={{ height: Spacing.sm }} />
        <SmallButton label="Reset" onPress={() => setDismissed(false)} />
      </View>
    );
  }

  return <DismissibleCard onDismiss={() => setDismissed(true)} />;
}

interface DismissibleCardProps {
  onDismiss: () => void;
}

function DismissibleCard({ onDismiss }: DismissibleCardProps) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const { reducedMotion } = useAccessibility();

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((event) => {
      "worklet";
      if (reducedMotion) return;
      translateX.value = event.translationX;
      opacity.value = Math.max(0.3, 1 - Math.abs(event.translationX) / 200);
    })
    .onEnd((event) => {
      "worklet";
      if (Math.abs(event.translationX) > swipeActionThreshold) {
        translateX.value = withTiming(event.translationX > 0 ? 400 : -400, {
          duration: 200,
        });
        opacity.value = withTiming(0, { duration: 200 }, () => {
          runOnJS(onDismiss)();
        });
      } else {
        translateX.value = withSpring(0, pressSpringConfig);
        opacity.value = withSpring(1, pressSpringConfig);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.dismissCard, animatedStyle]}>
          <Text style={styles.dismissCardTitle}>Drag me sideways</Text>
          <Text style={styles.dismissCardMeta}>
            Past {swipeActionThreshold}px — dismisses. Inside — springs back.
          </Text>
        </Animated.View>
      </GestureDetector>
      {/* Accessibility: provide a non-gesture path to dismissal */}
      <View style={{ height: Spacing.sm }} />
      <SmallButton label="Dismiss with button" onPress={onDismiss} />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 7. Spring vs timing
// ────────────────────────────────────────────────────────────────────────────

function SpringVsTimingDemo() {
  const springX = useSharedValue(0);
  const timingX = useSharedValue(0);
  const { reducedMotion } = useAccessibility();

  const springStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: springX.value }],
  }));
  const timingStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: timingX.value }],
  }));

  const fire = useCallback(() => {
    if (reducedMotion) {
      springX.value = 0;
      timingX.value = 0;
      return;
    }
    const next = springX.value === 0 ? 140 : 0;
    springX.value = withSpring(next, {
      damping: 12,
      stiffness: 150,
      mass: 0.6,
    });
    timingX.value = withTiming(next, {
      duration: 400,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [reducedMotion, springX, timingX]);

  return (
    <View>
      <View style={styles.compareTrack}>
        <Animated.View style={[styles.compareDot, springStyle]} />
        <Text style={styles.compareLabel}>Spring</Text>
      </View>
      <View style={{ height: Spacing.sm }} />
      <View style={styles.compareTrack}>
        <Animated.View style={[styles.compareDotTiming, timingStyle]} />
        <Text style={styles.compareLabel}>Timing (cubic in-out)</Text>
      </View>
      <View style={{ height: Spacing.md }} />
      <SmallButton label="Fire both" onPress={fire} />
      <Text style={styles.compareHint}>
        Tap rapidly: the spring re-targets gracefully; the timing curve has to
        cancel and restart.
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 8. Layout animation on add/remove
// ────────────────────────────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  label: string;
}

const SEED_TASKS: TaskItem[] = [
  { id: "a", label: "Log breakfast" },
  { id: "b", label: "Log lunch" },
  { id: "c", label: "Log dinner" },
];

function LayoutAnimationDemo() {
  const [tasks, setTasks] = useState<TaskItem[]>(SEED_TASKS);

  const addTask = () => {
    const id = String(Math.random()).slice(2, 8);
    setTasks((prev) => [...prev, { id, label: `Snack ${prev.length + 1}` }]);
  };

  const removeTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const reset = () => setTasks(SEED_TASKS);

  return (
    <View>
      {tasks.map((task) => (
        <Animated.View
          key={task.id}
          entering={FadeIn.duration(250)}
          exiting={FadeOut.duration(180)}
          layout={Layout.springify().damping(18).stiffness(150)}
          style={styles.taskRow}
        >
          <Text style={styles.taskLabel}>{task.label}</Text>
          <Pressable
            onPress={() => removeTask(task.id)}
            hitSlop={8}
            style={styles.taskRemove}
          >
            <Text style={styles.taskRemoveText}>×</Text>
          </Pressable>
        </Animated.View>
      ))}
      <View style={{ height: Spacing.sm }} />
      <View style={styles.row}>
        <SmallButton label="Add" onPress={addTask} />
        <SmallButton label="Reset" tone="secondary" onPress={reset} />
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 9. Reduce Motion status (informational)
// ────────────────────────────────────────────────────────────────────────────

function ReducedMotionStatus() {
  const { reducedMotion } = useAccessibility();
  return (
    <View>
      <Text style={styles.statusText}>
        Reduce Motion is currently:{" "}
        <Text style={styles.statusStrong}>{reducedMotion ? "ON" : "OFF"}</Text>
      </Text>
      <Text style={styles.statusHint}>
        Toggle in iOS Settings → Accessibility → Motion → Reduce Motion. The
        change is live — every demo above will adjust without an app restart.
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared small button (avoids depending on the project's Button component)
// ────────────────────────────────────────────────────────────────────────────

interface SmallButtonProps {
  label: string;
  onPress: () => void;
  tone?: "primary" | "secondary";
}

function SmallButton({ label, onPress, tone = "primary" }: SmallButtonProps) {
  const scale = useSharedValue(1);
  const { reducedMotion } = useAccessibility();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onIn = () => {
    if (reducedMotion) return;
    scale.value = withSpring(0.96, pressSpringConfig);
  };
  const onOut = () => {
    if (reducedMotion) return;
    scale.value = withSpring(1, pressSpringConfig);
  };

  const buttonStyle: ViewStyle =
    tone === "primary" ? styles.smallButton : styles.smallButtonSecondary;
  const textStyle =
    tone === "primary"
      ? styles.smallButtonText
      : styles.smallButtonTextSecondary;

  return (
    <Pressable onPress={onPress} onPressIn={onIn} onPressOut={onOut}>
      <Animated.View style={[buttonStyle, animatedStyle]}>
        <Text style={textStyle}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.backgroundDefault,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing["3xl"],
    paddingBottom: Spacing.md,
    backgroundColor: palette.backgroundDefault,
    justifyContent: "flex-end",
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerTitle: {
    fontFamily: FontFamily.bold,
    color: palette.text,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing["5xl"],
  },
  intro: {
    marginBottom: Spacing.lg,
  },
  introText: {
    ...Typography.body,
    color: palette.textSecondary,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    ...Typography.h4,
    color: palette.text,
    marginBottom: Spacing.xs,
  },
  sectionDescription: {
    ...Typography.small,
    color: palette.textSecondary,
    marginBottom: Spacing.md,
  },
  demoBox: {
    backgroundColor: palette.backgroundSecondary,
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
    ...Shadows.small,
  },
  sectionTechnique: {
    ...Typography.caption,
    color: palette.textSecondary,
    marginTop: Spacing.sm,
    fontStyle: "italic",
  },

  // primary button
  primaryButton: {
    backgroundColor: palette.link,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.button,
    alignSelf: "flex-start",
  },
  primaryButtonText: {
    ...Typography.body,
    color: palette.buttonText,
    fontFamily: FontFamily.semiBold,
  },

  // heart
  heartPressable: {
    alignItems: "center",
  },
  heart: {
    fontSize: 56,
    color: palette.link,
    lineHeight: 64,
  },
  heartLabel: {
    ...Typography.small,
    color: palette.textSecondary,
    marginTop: Spacing.sm,
  },

  // ticker
  tickerWrap: {
    alignItems: "center",
  },
  tickerText: {
    ...Typography.h2,
    color: palette.calorieAccent,
    fontFamily: FontFamily.bold,
    minWidth: 160,
    textAlign: "center",
    padding: 0,
  },
  row: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    flexWrap: "wrap",
  },

  // skeleton
  skeletonWrap: {
    minHeight: 120,
  },
  skeletonBase: {
    backgroundColor: palette.backgroundTertiary,
    overflow: "hidden",
  },
  skeletonShimmer: {
    height: "100%",
    backgroundColor: withOpacity(palette.backgroundDefault, 0.6),
  },
  loadedTitle: {
    ...Typography.h4,
    color: palette.text,
  },
  loadedMeta: {
    ...Typography.small,
    color: palette.textSecondary,
    marginTop: 2,
  },

  // stagger
  staggerItem: {
    backgroundColor: palette.backgroundDefault,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
  },
  staggerItemText: {
    ...Typography.body,
    color: palette.text,
  },

  // swipe
  dismissCard: {
    backgroundColor: palette.backgroundDefault,
    borderRadius: BorderRadius.card,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: palette.border,
  },
  dismissCardTitle: {
    ...Typography.h4,
    color: palette.text,
    marginBottom: 4,
  },
  dismissCardMeta: {
    ...Typography.small,
    color: palette.textSecondary,
  },
  dismissedText: {
    ...Typography.body,
    color: palette.textSecondary,
    textAlign: "center",
  },

  // compare
  compareTrack: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    backgroundColor: palette.backgroundDefault,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderColor: palette.border,
  },
  compareDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.link,
  },
  compareDotTiming: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.accentBlue,
  },
  compareLabel: {
    ...Typography.small,
    color: palette.textSecondary,
    marginLeft: Spacing.md,
  },
  compareHint: {
    ...Typography.caption,
    color: palette.textSecondary,
    marginTop: Spacing.sm,
  },

  // tasks
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: palette.backgroundDefault,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
  },
  taskLabel: {
    ...Typography.body,
    color: palette.text,
  },
  taskRemove: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.backgroundTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  taskRemoveText: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    color: palette.textSecondary,
  },

  // status
  statusText: {
    ...Typography.body,
    color: palette.text,
  },
  statusStrong: {
    fontFamily: FontFamily.semiBold,
    color: palette.link,
  },
  statusHint: {
    ...Typography.small,
    color: palette.textSecondary,
    marginTop: Spacing.sm,
  },

  // small button
  smallButton: {
    backgroundColor: palette.text,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  smallButtonSecondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  smallButtonText: {
    ...Typography.small,
    color: palette.buttonText,
    fontFamily: FontFamily.semiBold,
  },
  smallButtonTextSecondary: {
    ...Typography.small,
    color: palette.text,
    fontFamily: FontFamily.semiBold,
  },

  // footer
  footer: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    alignItems: "center",
  },
  footerText: {
    ...Typography.caption,
    color: palette.textSecondary,
    textAlign: "center",
  },
});
