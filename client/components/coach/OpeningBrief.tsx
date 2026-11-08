import { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import { chatReplyTextFadeMs } from "@/constants/animations";
import { hasUsedFeature } from "@/lib/feature-tips-storage";
import { withFeatureChip } from "./coach-feature-chip";
import type { BriefAction, RenderedBrief } from "@shared/lib/opening-brief";

const MAX_CHIPS = 3;

interface OpeningBriefProps {
  brief: RenderedBrief;
  /** Chips and reminder answers: sent as the user's message. */
  onSend: (message: string) => void;
  /** A missed-meal reminder's Log button. */
  onQuickLog: () => void;
  /** Fires once when the brief first shows. */
  onShown?: () => void;
}

/** Server chips, with room kept for one feature the person hasn't used. */
function chipsFor(suggestions: readonly string[]): string[] {
  if (suggestions.length === 0) return [];
  const [feature] = withFeatureChip([], hasUsedFeature);
  return feature
    ? [...suggestions.slice(0, MAX_CHIPS - 1), feature]
    : suggestions.slice(0, MAX_CHIPS);
}

/**
 * The coach's opening message in a new chat (spec 2026-11-08): greeting,
 * the day's recap, one pointer and reply chips — or, when a reminder lit the
 * Coach tab dot, that reason first with buttons that answer it. Laid out like
 * an assistant message in `ChatBubble` (avatar dot + text column).
 *
 * The spoken text is its own `accessible` group; the buttons and chips sit
 * beside it, never inside, so VoiceOver can still reach them.
 */
export default function OpeningBrief({
  brief,
  onSend,
  onQuickLog,
  onShown,
}: OpeningBriefProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    onShown?.();
  }, [onShown]);

  const runAction = (action: BriefAction) => {
    if (action.kind === "quick-log") onQuickLog();
    else if (action.message) onSend(action.message);
  };

  const chips = chipsFor(brief.suggestions);
  const { reminder } = brief;
  // One flowing sentence run for screen readers (the saved text uses blank
  // lines between parts).
  const spoken = reminder
    ? `${brief.greeting} ${reminder.lead}`
    : brief.text.replace(/\n+/g, " ");

  return (
    <Animated.View
      entering={
        reducedMotion ? undefined : FadeIn.duration(chatReplyTextFadeMs)
      }
      style={styles.container}
    >
      <View style={styles.row}>
        <View
          style={[styles.avatarDot, { backgroundColor: theme.accentSolid }]}
        />
        <View style={styles.column}>
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={`NutriCoach: ${spoken}`}
          >
            <ThemedText style={[styles.text, styles.greeting]}>
              {brief.greeting}
            </ThemedText>
            {reminder ? (
              <View style={[styles.reminder, { borderLeftColor: theme.link }]}>
                <ThemedText style={styles.text}>{reminder.lead}</ThemedText>
              </View>
            ) : (
              <>
                <ThemedText style={styles.text}>{brief.recap}</ThemedText>
                {brief.stats.length > 0 && (
                  <View style={styles.stats}>
                    {brief.stats.map((stat) => (
                      <View
                        key={stat.label}
                        style={[
                          styles.stat,
                          { backgroundColor: theme.backgroundSecondary },
                        ]}
                      >
                        <ThemedText type="body" style={styles.statValue}>
                          {stat.value}
                        </ThemedText>
                        <ThemedText
                          type="caption"
                          style={{ color: theme.textSecondary }}
                        >
                          {stat.label}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                )}
                {brief.pointer && (
                  <ThemedText style={styles.text}>{brief.pointer}</ThemedText>
                )}
              </>
            )}
          </View>

          {reminder && (
            <>
              <View style={styles.actions}>
                {reminder.actions.map((action, i) => (
                  <PressableScale
                    key={action.label}
                    onPress={() => runAction(action)}
                    accessibilityRole="button"
                    accessibilityLabel={`${action.label}, ${reminder.lead}`}
                    style={[
                      styles.action,
                      i === 0
                        ? { backgroundColor: theme.accentSolid }
                        : { borderColor: theme.link, borderWidth: 1 },
                    ]}
                  >
                    <ThemedText
                      type="small"
                      style={{
                        color: i === 0 ? theme.buttonText : theme.link,
                        fontFamily: FontFamily.medium,
                      }}
                    >
                      {action.label}
                    </ThemedText>
                  </PressableScale>
                ))}
              </View>
              <ThemedText
                style={[styles.text, styles.afterActions]}
                accessibilityLabel={`NutriCoach: ${brief.recap}`}
              >
                {brief.recap}
              </ThemedText>
            </>
          )}
        </View>
      </View>

      {chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
        >
          {chips.map((chip) => (
            <PressableScale
              key={chip}
              scaleTo={0.95}
              onPress={() => onSend(chip)}
              accessibilityRole="button"
              accessibilityLabel={chip}
              style={[styles.chip, { borderColor: theme.border }]}
            >
              <ThemedText type="small" style={{ color: theme.link }}>
                {chip}
              </ThemedText>
            </PressableScale>
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: Spacing.md, marginBottom: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    paddingHorizontal: Spacing.lg,
  },
  avatarDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 2,
    flexShrink: 0,
  },
  column: { flex: 1, gap: Spacing.sm },
  text: { fontSize: 15, lineHeight: 25, fontFamily: FontFamily.regular },
  greeting: { fontFamily: FontFamily.semiBold },
  reminder: { borderLeftWidth: 3, paddingLeft: Spacing.sm, marginTop: 2 },
  stats: { flexDirection: "row", gap: Spacing.sm, marginVertical: 2 },
  stat: {
    flex: 1,
    borderRadius: BorderRadius.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  statValue: { fontFamily: FontFamily.semiBold },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  action: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
  },
  afterActions: { marginTop: Spacing.xs },
  chips: { flexGrow: 0, flexShrink: 0, marginTop: Spacing.md },
  chipsContent: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
  },
});
