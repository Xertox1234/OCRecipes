import React, { useMemo, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { toSecondPerson } from "./notebook-text-utils";
import type { CoachContextData } from "@/hooks/useCoachContext";

interface Props {
  context: CoachContextData;
  onSuggestionPress: (text: string) => void;
}

const CoachDashboard = React.memo(function CoachDashboard({
  context,
  onSuggestionPress,
}: Props) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(true);
  const expandedHeight = useSharedValue(1);

  const toggleExpanded = () => {
    expandedHeight.value = withTiming(expanded ? 0 : 1, { duration: 250 });
    setExpanded(!expanded);
  };

  const expandedStyle = useAnimatedStyle(() => ({
    maxHeight: expandedHeight.value * 300,
    opacity: expandedHeight.value,
  }));

  const { todayIntake, notebook, dueCommitments, suggestions, goals } = context;

  // Memoize notebook insight filter/slice to avoid recomputation on parent re-renders
  const topInsights = useMemo(
    () => notebook.filter((e) => e.type === "insight").slice(0, 2),
    [notebook],
  );

  return (
    <View
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
    >
      <Pressable
        onPress={toggleExpanded}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}
        accessibilityLabel={
          expanded ? "Collapse dashboard" : "Expand dashboard"
        }
        accessibilityRole="button"
      >
        <View>
          <ThemedText type="h4" style={styles.greeting}>
            {getGreeting()}
          </ThemedText>
          {!expanded && (
            <ThemedText
              type="caption"
              style={[styles.miniSummary, { color: theme.textSecondary }]}
            >
              {todayIntake
                ? `${todayIntake.totalCalories} cal today`
                : "No meals logged yet"}
            </ThemedText>
          )}
        </View>
        <ThemedText type="caption" style={{ color: theme.link }}>
          {expanded ? "Less \u25B4" : "See all \u25BE"}
        </ThemedText>
      </Pressable>

      <View style={styles.statRow}>
        <View
          style={[styles.stat, { backgroundColor: theme.backgroundDefault }]}
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
          style={[styles.stat, { backgroundColor: theme.backgroundDefault }]}
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
          style={[styles.stat, { backgroundColor: theme.backgroundDefault }]}
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

      <Animated.View style={[styles.expandedSection, expandedStyle]}>
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
                <View style={[styles.commitDot, { borderColor: theme.link }]} />
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
            accessibilityLabel={`Discuss: ${insight.content}`}
          >
            <ThemedText type="small" style={styles.insightText}>
              {toSecondPerson(insight.content)}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.link }}>
              {"\u2192"}
            </ThemedText>
          </Pressable>
        ))}
      </Animated.View>

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
  container: {
    borderRadius: 16,
    margin: 16,
    marginBottom: 8,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    paddingBottom: 8,
  },
  greeting: {},
  miniSummary: { marginTop: 2 },
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
