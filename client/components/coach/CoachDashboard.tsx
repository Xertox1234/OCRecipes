import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import type { CoachContextData } from "@/hooks/useCoachContext";

interface Props {
  context: CoachContextData;
  onSuggestionPress: (text: string) => void;
}

export default function CoachDashboard({ context, onSuggestionPress }: Props) {
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

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      <Pressable onPress={toggleExpanded} style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: theme.text }]}>{getGreeting()}</Text>
          {!expanded && (
            <Text style={[styles.miniSummary, { color: theme.textSecondary }]}>
              {todayIntake ? `${todayIntake.totalCalories} cal today` : "No meals logged yet"}
            </Text>
          )}
        </View>
        <Text style={{ color: theme.link, fontSize: 12 }}>
          {expanded ? "Less \u25B4" : "See all \u25BE"}
        </Text>
      </Pressable>

      <View style={styles.statRow}>
        <View style={[styles.stat, { backgroundColor: theme.backgroundDefault }]}>
          <Text style={[styles.statValue, { color: theme.link }]}>{todayIntake?.totalCalories ?? 0}</Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Calories</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: theme.backgroundDefault }]}>
          <Text style={[styles.statValue, { color: theme.success }]}>{todayIntake?.totalProtein ?? 0}g</Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Protein</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: theme.backgroundDefault }]}>
          <Text style={[styles.statValue, { color: theme.warning }]}>
            {goals ? goals.calories - (todayIntake?.totalCalories ?? 0) : "\u2014"}
          </Text>
          <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Remaining</Text>
        </View>
      </View>

      <Animated.View style={[styles.expandedSection, expandedStyle]}>
        {dueCommitments.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Commitments</Text>
            {dueCommitments.map((c) => (
              <View key={c.id} style={styles.commitmentRow}>
                <View style={[styles.commitDot, { borderColor: theme.link }]} />
                <Text style={[styles.commitText, { color: theme.text }]}>{c.content}</Text>
              </View>
            ))}
          </View>
        )}
        {notebook
          .filter((e) => e.type === "insight")
          .slice(0, 2)
          .map((insight) => (
            <Pressable
              key={insight.id}
              style={styles.insightRow}
              onPress={() => onSuggestionPress(insight.content)}
              accessibilityRole="button"
              accessibilityLabel={`Discuss: ${insight.content}`}
            >
              <Text style={[styles.insightText, { color: theme.text }]}>{insight.content}</Text>
              <Text style={{ color: theme.link, fontSize: 11 }}>{"\u2192"}</Text>
            </Pressable>
          ))}
      </Animated.View>

      {suggestions.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
          {suggestions.map((s, i) => (
            <Pressable key={i} style={[styles.chip, { backgroundColor: theme.backgroundDefault }]} onPress={() => onSuggestionPress(s)} accessibilityRole="button">
              <Text style={[styles.chipText, { color: theme.link }]}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const styles = StyleSheet.create({
  container: { borderRadius: 16, margin: 16, marginBottom: 8, overflow: "hidden" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, paddingBottom: 8 },
  greeting: { fontSize: 16, fontWeight: "600" },
  miniSummary: { fontSize: 12, marginTop: 2 },
  statRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
  stat: { flex: 1, borderRadius: 10, padding: 8, alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "700" },
  statLabel: { fontSize: 10, marginTop: 2 },
  expandedSection: { overflow: "hidden", paddingHorizontal: 14 },
  section: { marginBottom: 8 },
  sectionTitle: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  commitmentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  commitDot: { width: 14, height: 14, borderRadius: 4, borderWidth: 2 },
  commitText: { fontSize: 13, flex: 1 },
  insightRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  insightText: { fontSize: 13, flex: 1, marginRight: 8 },
  chips: { paddingBottom: 12 },
  chipsContent: { paddingHorizontal: 14, gap: 8 },
  chip: { borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  chipText: { fontSize: 13 },
});
