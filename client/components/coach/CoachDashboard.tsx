import React, { useMemo, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, Spacing } from "@/constants/theme";
import { toSecondPerson } from "./notebook-text-utils";
import { withFeatureChip } from "./coach-feature-chip";
import { hasUsedFeature } from "@/lib/feature-tips-storage";
import type { CoachContextData } from "@/hooks/useCoachContext";

interface Props {
  context: CoachContextData;
  onSuggestionPress: (text: string) => void;
  onNotebookPress: () => void;
}

/**
 * The top of the Coach screen. One row — greeting, today's calories, the
 * fold control and Notebook — always shows; everything else folds away so
 * the chat gets the room.
 */
const CoachDashboard = React.memo(function CoachDashboard({
  context,
  onSuggestionPress,
  onNotebookPress,
}: Props) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(true);

  const {
    todayIntake,
    notebook,
    dueCommitments,
    suggestions: serverSuggestions,
    goals,
  } = context;
  // Plus one chip for a feature they haven't used yet (import, receipt scan).
  const suggestions = withFeatureChip(serverSuggestions, hasUsedFeature);

  // Memoize notebook insight filter/slice to avoid recomputation on parent re-renders
  const topInsights = useMemo(
    () => notebook.filter((e) => e.type === "insight").slice(0, 2),
    [notebook],
  );

  // No "today": the greeting already says when, and the row has no room.
  const consumed = Math.round(todayIntake?.totalCalories ?? 0).toLocaleString();
  const summary = goals
    ? `${consumed} / ${Math.round(goals.calories).toLocaleString()} cal`
    : `${consumed} cal`;

  return (
    <View style={styles.container}>
      <View style={[styles.topRow, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.7 }]}
          hitSlop={{ top: 6, bottom: 6 }}
          accessibilityLabel={
            expanded ? "Collapse dashboard" : "Expand dashboard"
          }
          accessibilityRole="button"
        >
          <ThemedText type="h4" numberOfLines={1} style={styles.greeting}>
            {getGreeting()}
          </ThemedText>
          <ThemedText
            type="caption"
            numberOfLines={1}
            style={[styles.summary, { color: theme.textSecondary }]}
          >
            {summary}
          </ThemedText>
          <Feather
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={theme.link}
            accessible={false}
          />
        </Pressable>
        <Pressable
          onPress={onNotebookPress}
          style={[styles.notebookBtn, { borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Open notebook"
        >
          <Feather
            name="book-open"
            size={16}
            color={theme.textSecondary}
            accessible={false}
          />
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Notebook
          </ThemedText>
        </Pressable>
      </View>

      {expanded && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={[styles.card, { backgroundColor: theme.backgroundSecondary }]}
        >
          <View style={styles.statRow}>
            <View
              style={[
                styles.stat,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <ThemedText
                type="h4"
                style={[styles.statValue, { color: theme.link }]}
              >
                {todayIntake?.totalCalories ?? 0}
              </ThemedText>
              <ThemedText
                type="caption"
                style={[styles.statLabel, { color: theme.textSecondary }]}
              >
                Calories
              </ThemedText>
            </View>
            <View
              style={[
                styles.stat,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <ThemedText
                type="h4"
                style={[styles.statValue, { color: theme.proteinAccent }]}
              >
                {todayIntake?.totalProtein ?? 0}g
              </ThemedText>
              <ThemedText
                type="caption"
                style={[styles.statLabel, { color: theme.textSecondary }]}
              >
                Protein
              </ThemedText>
            </View>
            <View
              style={[
                styles.stat,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <ThemedText
                type="h4"
                style={[styles.statValue, { color: theme.badgeWarningText }]}
              >
                {goals
                  ? goals.calories - (todayIntake?.totalCalories ?? 0)
                  : "\u2014"}
              </ThemedText>
              <ThemedText
                type="caption"
                style={[styles.statLabel, { color: theme.textSecondary }]}
              >
                Remaining
              </ThemedText>
            </View>
          </View>

          <View style={styles.expandedSection}>
            {dueCommitments.length > 0 && (
              <View style={styles.section}>
                <ThemedText
                  type="caption"
                  style={[styles.sectionTitle, { color: theme.textSecondary }]}
                >
                  Commitments
                </ThemedText>
                {dueCommitments.map((c) => (
                  <View key={c.id} style={styles.commitmentRow}>
                    <View
                      style={[styles.commitDot, { borderColor: theme.link }]}
                    />
                    <ThemedText type="small" style={styles.commitText}>
                      {toSecondPerson(c.content)}
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}
            {topInsights.map((insight) => (
              <Pressable
                key={insight.id}
                style={({ pressed }) => [
                  styles.insightRow,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => onSuggestionPress(insight.content)}
                accessibilityRole="button"
                accessibilityLabel={`Discuss: ${toSecondPerson(insight.content)}`}
              >
                <ThemedText type="small" style={styles.insightText}>
                  {toSecondPerson(insight.content)}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.link }}>
                  {"\u2192"}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {suggestions.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chips}
              contentContainerStyle={styles.chipsContent}
            >
              {suggestions.map((s, i) => (
                <PressableScale
                  scaleTo={0.95}
                  key={i}
                  style={[
                    styles.chip,
                    { backgroundColor: theme.backgroundDefault },
                  ]}
                  onPress={() => onSuggestionPress(s)}
                  accessibilityLabel={s}
                  accessibilityRole="button"
                >
                  <ThemedText type="small" style={{ color: theme.link }}>
                    {s}
                  </ThemedText>
                </PressableScale>
              ))}
            </ScrollView>
          )}
        </Animated.View>
      )}
    </View>
  );
});

export default CoachDashboard;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const styles = StyleSheet.create({
  container: {},
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
    minHeight: 44,
  },
  greeting: { flexShrink: 0 },
  summary: { flexShrink: 1 },
  notebookBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  card: {
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    paddingTop: 14,
    overflow: "hidden",
  },
  statRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  stat: { flex: 1, borderRadius: 10, padding: 8, alignItems: "center" },
  statValue: {},
  statLabel: { marginTop: 2 },
  expandedSection: { overflow: "hidden", paddingHorizontal: 14 },
  section: { marginBottom: 8 },
  sectionTitle: {
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  commitmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  commitDot: { width: 14, height: 14, borderRadius: 4, borderWidth: 2 },
  commitText: { flex: 1 },
  insightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  insightText: { flex: 1, marginRight: 8 },
  chips: { paddingBottom: 12 },
  chipsContent: { paddingHorizontal: 14, gap: 8 },
  chip: { borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
});
