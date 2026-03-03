import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import {
  getMicronutrientBarColor,
  clampPercentage,
} from "./progress-display-utils";

interface MicronutrientBarProps {
  nutrientName: string;
  amount: number;
  unit: string;
  percentDailyValue: number;
}

export default function MicronutrientBar({
  nutrientName,
  amount,
  unit,
  percentDailyValue,
}: MicronutrientBarProps) {
  const { theme } = useTheme();

  const barColor = getMicronutrientBarColor(percentDailyValue);
  const clampedPercent = clampPercentage(percentDailyValue);

  return (
    <View
      style={[styles.row, { marginBottom: Spacing.sm }]}
      accessible
      accessibilityLabel={`${nutrientName}: ${amount} ${unit}, ${percentDailyValue}% of daily value`}
    >
      <View style={styles.labelCol}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {nutrientName}
        </Text>
        <Text style={[styles.amount, { color: theme.textSecondary }]}>
          {amount} {unit}
        </Text>
      </View>
      <View style={styles.barCol}>
        <View
          style={[
            styles.barBg,
            {
              backgroundColor: theme.border,
              borderRadius: 3,
            },
          ]}
        >
          <View
            style={[
              styles.barFill,
              {
                backgroundColor: barColor,
                width: `${clampedPercent}%`,
                borderRadius: 3,
              },
            ]}
            importantForAccessibility="no"
          />
        </View>
      </View>
      <Text style={[styles.percent, { color: barColor }]}>
        {percentDailyValue}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  labelCol: { width: 120 },
  name: { fontSize: 13, fontWeight: "500" },
  amount: { fontSize: 11, marginTop: 1 },
  barCol: { flex: 1, marginHorizontal: 8 },
  barBg: { height: 6, overflow: "hidden" },
  barFill: { height: "100%" },
  percent: { width: 40, textAlign: "right", fontSize: 13, fontWeight: "600" },
});
