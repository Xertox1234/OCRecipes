import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "@/hooks/useTheme";
import { PressableScale } from "@/components/PressableScale";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { WeeklyReportBlock } from "@shared/schemas/coach-blocks";
import {
  reportEyebrow,
  reportSpoken,
  reportStats,
  weeklyReportScreen,
} from "./weekly-report-card-utils";

interface Props {
  block: WeeklyReportBlock;
}

/**
 * The user's weekly report in the chat (Coach roadmap A3): the week, its
 * headline and three counts, read by the server from the stored report. A
 * report never changes once written, so the card needs no fresh read. A tap
 * opens the full report on the Profile tab, as the report popup does: from
 * the Coach tab it switches tabs, and from the full-screen Coach it closes
 * the chat (back from the report lands on Profile, not the conversation).
 */
// The eyebrow keeps the chat cards' 1.2 cap; the headline, counts and the
// call to action grow further, since this card is something to act on.
const WeeklyReportCard = React.memo(function WeeklyReportCard({
  block,
}: Props) {
  const { theme } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <PressableScale
      // The root stack's nested form: a bare "WeeklyReport" is not
      // delivered from another tab. `pop` returns to the existing Main
      // instead of pushing a second one above the full-screen Coach.
      onPress={() =>
        navigation.navigate("Main", weeklyReportScreen(block.reportId), {
          pop: true,
        })
      }
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={reportSpoken(block)}
      accessibilityHint="Opens the full report"
      testID="weekly-report-card"
      style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}
    >
      <Text
        style={[styles.eyebrow, { color: theme.textSecondary }]}
        maxFontSizeMultiplier={1.2}
      >
        {reportEyebrow(block)}
      </Text>
      <Text
        style={[styles.headline, { color: theme.text }]}
        maxFontSizeMultiplier={1.5}
      >
        {block.headline}
      </Text>
      <View style={styles.stats}>
        {reportStats(block).map((stat) => (
          <Text
            key={stat}
            style={[styles.stat, { color: theme.text }]}
            maxFontSizeMultiplier={1.5}
          >
            {stat}
          </Text>
        ))}
      </View>
      <Text
        style={[styles.cta, { color: theme.link }]}
        maxFontSizeMultiplier={1.5}
      >
        Read your week
      </Text>
    </PressableScale>
  );
});

export default WeeklyReportCard;

const styles = StyleSheet.create({
  container: { borderRadius: 12, padding: 12, marginTop: 8, gap: 6 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  headline: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  stats: { gap: 2 },
  stat: { fontSize: 13 },
  cta: { fontSize: 14, fontWeight: "600", minHeight: 24, marginTop: 2 },
});
